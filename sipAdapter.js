(function () {  
	/**
	* @summary Provides SIP over websocket interface for session and call handling
	* @param {Userid} userid The user's unique identifier
	* @param {Token} token An authorization token associated with the provided userid
	* @param {SessionConfig} config session initialization parameters
	* @param {Session} session object to create the adapter
	*/
	function SipAdapter(ws, userId, token, config, session) {
		/**
		 * Pointer to the MSRP manager to use.
		 */
		this.Msrp = orcaALU.SipMsrp;
		/**
		 * Internal SIP stack.
		 * @type {sip.Stack}
		 * @private
		 */
		this.stack = undefined;

		/**
		 * SIP User Agent used for registration.
		 * @type {sip.UserAgent}
		 * @private
		 */
		this.uaReg = null;

		/**
		 * SIP Transport protocol.
		 * @type string
		 * @private
		 */
		this.transport = "ws";

		/**
		 * SIP Transport protocol.
		 * @type string
		 * @private
		 */

		/* put orca version information into user agent */
		this.userAgent = "ALU ORCA Agent ";
		if(typeof orcaVersion !== 'undefined')
			this.userAgent += orcaVersion;
		//suppose browser should be Firefox/xx or Chrome/xx
		var browser_version = navigator.userAgent.match(/(Firefox|Chrome)\/(\d|\.)+/);
		if(browser_version && browser_version.length >= 2)
			this.userAgent = this.userAgent + ' ' + browser_version[0]; 

		/**
		 * Listen IP.
		 * @type string
		 * @private
		 */
		this.listenIp = 'r' + Math.floor(Math.random() * 10000000000) + ".invalid";

		/**
		 * Listen Port.
		 * @type number
		 * @private
		 */
		this.listenPort = 0;

		/**
		 * Instance ID
		 * @type string
		 * @private
		 */
		this.instanceId = undefined;

		/**
		 * Session expiration, expressed by seconds.
		 * @type number
		 * @private
		 */
		this.sessionExpires = isNaN(config.providerConfig.expires) ? 600 : parseInt(config.providerConfig.expires);

		this.refreshInProgress = false;
		this.refresh_timer = 0;

		/*  Allow timeouts to cover 408 response from registers sent 
 		 * during a network outage
		 */
		this.timeouts_allowed = 1;

		/**
		 * Expiration of the current presence state, expressed by seconds.
		 * @type number
		 * @private
		 */
		 this.presenceExpires = 300;
		
		/**
		 * Timer ID of the pending presence refresh.
		 * @type number
		 * @private
		 */
		 this.presenceRefreshTimer = undefined;
		
		/**
		 * The entity-tag of the current presence state.
		 * @type string
		 * @private
		 */
		 this.presenceEtag = undefined;
		
		/**
		 * Queue of attempted presence updates.
		 * @type object
		 * @private
		 */
		 this.presencePendingUpdates = [];

		/**
		 * Local Address Of Record (AOR).
		 * @type string
		 * @private
		 */
		this.localAOR = userId;

		this.session = session;
		this.config = config;
		this.token = token;
		this.ws = ws;
		
		/**
		* @summary Update token.key
		*/
		this.updateToken = function (tokenKey) {
			console.debug("sipAdapter.updateToken" + token);
			this.token.key = tokenKey;
		};

		/**
		* @summary Set session status to notify application  
		* @type {SessionStatus}
		*/
		this.setSessionStatus = function(status) {
			console.debug('setSessionStatus() session status -> ' + status);
			this.session.setSessionStatus(status);
		};

		/**
		* @summary Sends registration request  
		*/
		this.createSession = function() {
			if(!this.stack){
				this.createStack();
			}

			if ( this.session.ws_only )
			{
				console.log( "Setting status to connected for ws only session");
				this.setSessionStatus(SessionStatus.CONNECTED);
			}
			else
			{	
				this.register();
				this.setSessionStatus(SessionStatus.CONNECTING);
			}
		};

		/**
		* @summary Terminate registration  
		*/
		this.terminateSession = function() {
			this.unregister();
		};

		/**
		* @summary Creates call session
		* @param {string[]} dest list of user identifier of the call recipients  
		* @type {SessionStatus}
		*/
		this.createCallSession = function(call, dest, sdp, src) {
			console.debug('createCallSession() dest: ' + dest);
			if(this.session.sessionStatus !== SessionStatus.CONNECTED){
				console.error('sessionStatus is: ' + this.session.sessionStatus);
				//terminate the call
				call.clean();
				return;
			}
			this.createAndSendInviteRequest(call, dest, sdp);
		};

		/**
		* @summary Answers incoming call and sends 200 OK response with sdp
		*/
		this.acceptCallSession = function(call, sdp) {
			this.sendResponse(call, 200, 'OK', sdp);
		};

		/**
		* @summary Rejects incoming call
		*/
		this.rejectCallSession = function(call, code, status) {
			if(code && status){
				this.sendResponse(call, code, status);
			}
			else
				this.sendResponse(call, 480, 'Temporarily Unavailable');
		};

		/**
		* @summary Cancels outgoing call before it is answered
		*/
		this.cancelCallSession = function(call) {
			this.cancel(call);
		};

		/**
		* @summary Terminates call and sends BYE
		*/
		this.terminateCallSession = function(call) {
			this.bye(call);
		};

		/**
		* @summary Cleans the resource for the call session
		*/
		this.cleanCallSession = function(call) {
			console.debug("cleanCallSession()");
			if (call.uaCall !== null) {
				if (call.uaCall instanceof sip.Dialog) {
					call.uaCall.close();
				}
				call.uaCall = null;
			}
		};

		/**
		* @summary Sends SIP response to request
		*/
		this.sendResponse = function(call, code, status, sdp) {
			console.debug('sendResponse(): ' + code + ' ' + status);
			// if(this.session.sessionStatus !== SessionStatus.CONNECTED){
			// 	console.error('sessionStatus is: ' + this.session.sessionStatus);
			// 	return;
			// }
			if(code === 200){
				this.sendInviteResponse(call, code, status, sdp);
			}
			else{
				this.sendInviteResponse(call, code, status);
			}
		};

		/**
		 * @summary Creates the SIP stack
		 * @private
		 */
		this.createStack = function () {
			console.debug("Session.createStack()");
			var transportInfo = new sip.TransportInfo(this.listenIp, this.listenPort, this.transport, false, true, true);
			this.stack = new sip.Stack(this, transportInfo);
		};

		/**
		* @summary Sends a SIP request REGISTER to register the web user into the IMS Core.
		* @private
		*/
		this.register = function () {
			var outboundProxy, request;
			if(!this.stack)
				this.createStack();
			console.debug("Session.register()");
			this.uaReg = new sip.UserAgent(this.stack, undefined, undefined, this.config.providerConfig.breaker);
			this.uaReg.localParty = new sip.Address(this.localAOR);
			this.uaReg.remoteParty = new sip.Address(this.localAOR);

			outboundProxy = this.getRouteHeader();
			outboundProxy.value.uri.param.transport = this.transport;
			//this.uaReg.routeSet = [outboundProxy];

			request = this.createRegister();
			request.setItem('Expires', new sip.Header(this.sessionExpires.toString(), 'Expires'));
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			console.log( "userId = " + userId);
			console.log( "token.id = " + token.id);

            if (this.token.authtype == "SSO-Auth") {
               var ssoAuthToken = this.token.key;
               var authorizationHeader = ssoAuthToken.authorizationHeader;
               var pAccessNetworkInfoHeader = ssoAuthToken.pAccessNetworkInfoHeader;
               console.log( "authorizationHeader = " + authorizationHeader);
               console.log( "pAccessNetworkInfoHeader = " + pAccessNetworkInfoHeader);

		       request.setItem('Authorization', new sip.Header(authorizationHeader, 'Authorization'));
		        
		       if(pAccessNetworkInfoHeader){
		            request.setItem('P-Access-Network-Info', new sip.Header(pAccessNetworkInfoHeader, 'P-Access-Network-Info'));
		       }
            }
	    else
	    {
		/*
		 *  For IMS Authentication, the authorization header is included in the
		 *  initial REGISTER message if configured to do so or
		 *  if the autoAnswerTimer is running.  The autoAnswerTimer would be running
		 *  in order to support Service Continuity scenarios where the client
		 *  is reloaded in the middle of a call.
		 */
		if (   ( this.session.autoAnswerTimer )
		    || ( this.config.providerConfig.sendAuthOnInitReg ) )
		{
			var authorizationParams = {
				username : '"' + token.id + '"',  // eg. username="privid17315400048@cpr01.lucentlab.com"
				uri : '"sip:' + userId.slice( userId.indexOf('@') + 1) + '"',  // eg. uri="sip:cpr01.lucentlab.com"
				realm : '"' + userId.slice( userId.indexOf('@') + 1) + '"',  // eg. realm="cpr01.lucentlab.com"
				nonce : '""',
				response : '""'};

			request.setItem('Authorization', new sip.Header(
				"Digest " +
				"username=" + authorizationParams.username + "," +
				"realm=" + authorizationParams.realm + "," +
				"uri=" + authorizationParams.uri + "," +
				"nonce=" + authorizationParams.nonce + "," +
				"response=" + authorizationParams.response + "," +
				"algorithm=" + "MD5",
				'Authorization'));
		}
            }
			//console.debug("Session.register() request = " + request);
			//this.params.registerStatus = this.RegisterStatus.REGISTERING;
			this.uaReg.sendRequest(request);
			if ( this.config.providerConfig.registerResponseTime > 0 )
			{
				var self = this;
				this.registerResponseTimer = setTimeout(function () { self.registerTimeout(); }, this.config.providerConfig.registerResponseTime * 1000 ); 
			}
		};

		/**
		* @summary Send a register refresh to maintain the current registration with the IMS core
		*/
		this.register_refresh = function () {
			var outboundProxy, request;
			console.debug("[" + new Date().toUTCString() + "] " + "Session.register_refresh()");
			request = this.createRegister();
			request.setItem('Expires', new sip.Header(this.sessionExpires.toString(), 'Expires'));
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			if ( this.config.providerConfig.reUseCallidInReregDereg )
			{
				request.setItem( 'Call-ID', new sip.Header(this.savedCallId.toString(), 'Call-ID'));
			}
			//console.debug("Session.register_refresh() request = " + request);

            if (this.token.authtype == "SSO-Auth") {      
               var ssoAuthToken = this.token.key;
               var authorizationHeader = ssoAuthToken.authorizationHeader;
               var pAccessNetworkInfoHeader = ssoAuthToken.pAccessNetworkInfoHeader;
               console.log( "authorizationHeader = " + authorizationHeader);
               console.log( "pAccessNetworkInfoHeader = " + pAccessNetworkInfoHeader);

		       request.setItem('Authorization', new sip.Header(authorizationHeader, 'Authorization'));
		        
		       if(pAccessNetworkInfoHeader){
		            request.setItem('P-Access-Network-Info', new sip.Header(pAccessNetworkInfoHeader, 'P-Access-Network-Info'));
		       }
            }
	    else
	    {
		if (   ( this.session.needAuthOnReRegister )
		    || ( this.config.providerConfig.sendAuthOnReregDereg ) )
		{
                        // Add Authorization Header
                        var authorizationParams = {
                        	username : '"' + token.id + '"',  // eg. username="privid17315400048@cpr01.lucentlab.com"
                        	uri : '"sip:' + userId.slice( userId.indexOf('@') + 1) + '"',  // eg. uri="sip:cpr01.lucentlab.com"
                                realm : '"' + userId.slice( userId.indexOf('@') + 1) + '"', // eg. realm="cpr01.lucentlab.com"
                                nonce : '""',
                                response : '""'};

                      	 request.setItem('Authorization', new sip.Header(
                         	"Digest " +
                         	"username=" + authorizationParams.username + "," +
                         	"realm=" + authorizationParams.realm + "," +
                         	"uri=" + authorizationParams.uri + "," +
                         	"nonce=" + authorizationParams.nonce + "," +
                        	"response=" + authorizationParams.response,
                        		'Authorization'));
		}
             }

			this.uaReg.sendRequest(request);
			this.refreshInProgress = true;

			if ( this.config.providerConfig.registerResponseTime > 0 )
			{
				var self = this;
				this.registerResponseTimer = setTimeout(function () { self.registerTimeout(); }, this.config.providerConfig.registerResponseTime * 1000 ); 
			}

			if ( this.session.mdsp.isFeatureEnabled() )
			{
				this.session.mdsp.logContacts("at end register_refresh", true);
			}
		};

		this.registerTimeout = function () {

			if ( this.session.socketStatus == this.session.WebSocketStatus.CONNECTED )
			{
				// No response to a register so take down websocket connection
				console.log( "Registration response timeout" );
				this.session.onWebSocketError();
				this.session.closePending = true;
				this.ws.close();
			}
			else	
			{
				console.log("Ignoring registration timeout because ws connection is already disconnected ");
			}
		}


		/**
		* @summary Sends a SIP request REGISTER to unregister the web user into the IMS Core.
		* @private
		*/
		this.unregister = function () {
			console.debug("Session.unregister()");
			clearTimeout(this.presenceRefreshTimer);
			this.sendUpdatePresence("", false, false, true);
			var request = this.createRegister();
			request.setItem('Expires', new sip.Header("0", 'Expires'));
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			if ( this.config.providerConfig.reUseCallidInReregDereg )
			{
				request.setItem('Call-ID', new sip.Header(this.savedCallId.toString(), 'Call-ID'));
			}

			if (this.token.authtype == "SSO-Auth") {
				var ssoAuthToken = this.token.key;
				var authorizationHeader = ssoAuthToken.authorizationHeader;
				var pAccessNetworkInfoHeader = ssoAuthToken.pAccessNetworkInfoHeader;
				console.log( "authorizationHeader = " + authorizationHeader);
				console.log( "pAccessNetworkInfoHeader = " + pAccessNetworkInfoHeader);

				request.setItem('Authorization', new sip.Header(authorizationHeader, 'Authorization'));

				if(pAccessNetworkInfoHeader){
					request.setItem('P-Access-Network-Info', new sip.Header(pAccessNetworkInfoHeader, 'P-Access-Network-Info'));
				}
			} else {
				if ( this.config.providerConfig.sendAuthOnReregDereg )
				{
					// Add Authorization Header
					var authorizationParams = {
					username : '"' + token.id + '"',  // eg. username="privid17315400048@cpr01.lucentlab.com"
					uri : '"sip:' + userId.slice( userId.indexOf('@') + 1) + '"',  // eg. uri="sip:cpr01.lucentlab.com"
					realm : '"' + userId.slice( userId.indexOf('@') + 1) + '"', // eg. realm="cpr01.lucentlab.com"
					nonce : '""',
					response : '""'};

					request.setItem('Authorization', new sip.Header(
						"Digest " +
						"username=" + authorizationParams.username + "," +
						"realm=" + authorizationParams.realm + "," +
						"uri=" + authorizationParams.uri + "," +
						"nonce=" + authorizationParams.nonce + "," +
						"response=" + authorizationParams.response,
						'Authorization'));
				}
			}
			//console.debug("Session.unregister() request = " + request);
			//this.params.registerStatus = "unregistering";
			this.uaReg.sendRequest(request);
			if (this.refresh_timer) {
				clearTimeout(this.refresh_timer);
			}
			this.savedCallId = undefined;
		};

		/**
		* @summary Create SIP Contact Header with needed content.
		* @private
		*/
		this.createContactHeader = function ( sipMethod) {
			var c;

			console.debug("adapter.createContactHeader()");

			if ( sipMethod == 'REGISTER') {
				c = new sip.Header( this.stack.uri.toString(), 'Contact');
				c.setItem('reg-id', '1');
				this.createInstanceId();
			}
			else {
				c = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			}

			c.value.uri.user = this.getUsername(this.localAOR);
			c.value.displayName = this.token.displayName;

			if (this.config.providerConfig.breaker) {
				c.value.uri.param.transport = 'ws';
				c.value.uri.param['rtcweb-breaker'] = 'yes';
			}

			if (   ( sipMethod == 'REGISTER')
			    || ( this.session.mdsp.isFeatureEnabled() ) )
			{
				c.setItem('+sip.instance', this.instanceId);
			}

			if ( this.session.mdsp.isFeatureEnabled() )
			{
				/*
				 *  Add secondary device id (if it's not empty),
				 *  eg.    mobility="fixed"
				 *     or  +g.gsma.rcs.ipcall
				 *  to contact header.
				 */
				var secondaryDeviceId = this.session.mdsp.getSecDeviceId();
				if ( secondaryDeviceId != '' )
				{
					c.setItem( secondaryDeviceId);
				}

				/*
				 *  Add GRUU (gr=).
				 *  eg. gr=urn:uuid:PC_00-23-AE-7F-FA-8E
				 *  this has to be a sip-uri parameter.
				 */
				if ( this.session.mdsp.myOwnGruu != '' )
				{
					c.value.uri.param.gr = this.session.mdsp.myOwnGruu;
				}
			}

			return c;
		};

		/**
		* @summary Creates a SIP request REGISTER.
		* @private
		*/
		this.createRegister = function () {
			var request, c;

			console.debug("Session.createRegister()");
			request = this.uaReg.createRequest('REGISTER');
			c = this.createContactHeader( 'REGISTER');
			request.setItem('Supported', new sip.Header('path, gruu', 'Supported'));
			request.setItem('Contact', c);

			if (this.token.authtype == "Token-Auth") {
				console.debug("token.authtype: Token-Auth, token.key: " + this.token.key);
				request.setItem('X-ALU-Authorization', new sip.Header("access-token=\"" + this.token.key + "\"", 'X-ALU-Authorization'));
			}

			return request;
		};

		/**
		* @summary Extracts the username part of a URI.
		* @param {string} uri URI
		* @returns {string}
		* @private
		*/
		this.getUsername = function (uri) {
			var username1, username2, username3, username4;
			username1 = uri.split('<')[1];
			// remove display name + '<'
			if (username1 === undefined) {
				username1 = uri;
			}
			username2 = username1.split('>')[0];
			// remove '>' + params
			if (username2 === undefined) {
				username2 = username1;
			}
			username3 = username2.split(':')[1];
			// remove 'sip:' scheme
			if (username3 === undefined) {
				username3 = username2;
			}
			username4 = username3.split('@')[0];
			// remove '@' + domain
			if (username4 === undefined) {
				username4 = username3;
			}
			return username4;
		};

		/**
		* @summary Creates a header 'Route' from the username, for a SIP messsage.
		* @param {string} username username
		* @returns {sip.Header}
		* @private
		*/
		this.getRouteHeader = function (username) {
			var outboundProxyAddress = this.config.uri.split('/')[2].trim() + ';transport=' + this.transport;
			return new sip.Header("<sip:" + (username ? username + "@" : "") + outboundProxyAddress + ";lr>", 'Route');
		};

		/**
		* @summary Creates a random UUID.
		* @returns {string}
		* @private
		*/
		this.createUUID4 = function () {
			return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
				var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
				return v.toString(16);
			});
		};

		/**
		* @summary Creates a unique instance ID for the Session.
		* @private
		*/
		this.createInstanceId = function () {
			/*
			 *  If the instanceId in the adapter variable (this.instanceId) is available
			 *  then just use it.  Otherwise, get it from localStorage and save
			 *  it in this.instanceId.  If the instanceId is not found in localStorage
			 *  then generate it and save it in both places.
			 *  We don't want to generate new instanceId just because we reloaded
			 *  the browser or saved our config settings because doing so can
			 *  create extra and unnecessary devie registration entries on the CTS
			 *  for devices with shared PUIDs.
			 */
                        if (!this.instanceId && localStorage !== "undefined") {
				this.instanceId = localStorage.getItem( "instance_id_" + this.token.id);
                                if (!this.instanceId) {
                                        this.instanceId = "<urn:uuid:" + this.createUUID4() + ">";
					localStorage.setItem("instance_id_" + this.token.id, this.instanceId);
					console.debug("New instanceId generated = " + this.instanceId);
                                } else {
					console.debug("Existing instanceId from localStorage = " + this.instanceId);
				}
                        }
			if ( this.session.mdsp.myOwnGruu == '' )
			{
				this.session.mdsp.myOwnGruu = this.instanceId.substring( 1, this.instanceId.length - 1);
			}
		};

		/**
		* @summary Creates a new timer instance.
		* @private
		*/
		this.createTimer = function (obj, stack) {
			return new sip.TimerImpl(obj);
		};

		/**
		* @summary Writes to console a log message pushed from SIP stack.
		* @private
		*/
		this.debug = function (msg) {
			console.debug("[SIP] " + msg);
		};

		/**
		* @summary Sends data into the WebSocket connection.
		* @private
		*/
		this.send = function (data, addr, stack) {
			var message = "=> " + addr[0] + ":" + addr[1] + "\n" + data;
			console.debug("[" + new Date().toUTCString() + "] " + "Session.send() message " + message);
			try {
				this.ws.send(data, addr[0], addr[1]);
			} catch (e) {
				this.ws.send(data);
			}
		};

		/**
		* @summary Receives data from the WebSocket
		* @private
		* call sip stack to parse the data. sip stack will callback for request/response
		*/
		this.received = function (data) {
			console.debug("\n[" + new Date().toUTCString() + "] " + "sipAdapter.received()\n");
			this.stack.received(data, ["127.0.0.1", 0])
		};

		/**
		* @summary Receives a SIP response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @param {sip.Stack} stack SIP stack instance
		* @private
		*/
		this.receivedResponse = function (ua, response, stack) {
			console.debug("\n[" + new Date().toUTCString() + "] " + "sipAdapter.receivedResponse()");

			var method, callId, call;
			method = ua.request.method;
			if (method === 'REGISTER') {
				this.receivedRegisterResponse(ua, response);
			} else if (method === 'MESSAGE') {
				if ( ua.request.getItem('Content-Type').value === "message/cpim" ) {
					console.info("ua.request.body: " + ua.request.body);
					var body = this.parseGetMessageBody(ua.request.body);			
					var bodyContentType = this.parseGetMessageContentType(ua.request.body).trim();
					console.log("message body: " + body);
					console.log("bodyContentType:" + bodyContentType);
					if (bodyContentType.trim() === "message/imdn+xml"){
						this.receivedSmsIMDNMessageResponse( ua, response);
					} else {
						this.receivedSmsMessageResponse( ua, response);
					}
				} else {
					this.receivedPageModeMessageResponse(ua, response);
				}				
			} else if (method === 'PUBLISH') {
				this.receivedUpdatePresenceResponse(ua, response);
			} else if (method === 'SUBSCRIBE') {
				if ( ua.request._headers.event.value == "dialog" ) {
					this.receivedSubscribeDialogResponse( ua, response);
				} else if ( ua.request._headers.event.value == "presence" ) {
					this.receivedSubscribePresenceResponse( ua, response);
				}
			} else {
				callId = response.getItem("call-id").value;
				call = this.session.getCall(callId);
				if (call === null || call.uaCall.callId !== ua.callId) {
					console.warn("Session.ReceivedResponse() Receive a SIP response for a unknow call. Ignore it.");
					return;
				}
				if (method === "INVITE") {
					this.receivedInviteResponse(call, ua, response);
				} else if (method === "BYE") {
					call.terminatedCallSessionEvent({name: CallStatus.DISCONNECTED});
					// this.receivedByeResponse(call, ua, response);
				} else if (method === "CANCEL") {
					call.terminatedCallSessionEvent({name: CallStatus.DISCONNECTED});
					// this.receivedByeResponse(call, ua, response);
				} else {
					console.warn("Session.receivedResponse() Ignoring SIP response for method=" + method);
				}
			}
		};

		/**
		* @summary Received a SIP request.
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} request SIP received request
		* @param {sip.Stack} stack SIP stack
		* @private
		*/
		this.receivedRequest = function (ua, request, stack) {
			console.debug("\n[" + new Date().toUTCString() + "] " + "sipAdapter.receivedRequest()");
			var callId, call, method;
			// callId = request.getItem("call-id").value;
			// call = this.getCall(callId);
			// if (call === null) {
			// 	previousCall = true;
			// 	this.callback.createCall(null, null, this);
			// 	call = previousCall;
			// 	previousCall = null;
			// 	this.calls.push(call);
			// }

			method = request.method;
			if (method === "INVITE") {
				this.receivedInvite(ua, request);
			} else if (method === "BYE") {
				this.receivedBye(ua, request)
				// call.terminatedCallSessionEvent({name: CallStatus.DISCONNECTED});
			} else if (method === "ACK") {
				this.receivedAck(ua, request);
				// call.acceptedCallSessionEvent({name: CallStatus.CONNECTED});
			} else if (method === "INFO") {
				this.receivedInfo(ua, request);
			} else if (method === "NOTIFY") {
				var event = request.getItem('event').value;
				if (event == 'presence') {
					this.receivedPresenceNotify(ua, request);
				} else if ( event == 'dialog' ) {
					this.receivedDialogNotify(ua, request);
				} else {
					this.receivedNotify(ua, request);
				}
			} else if (method === "MESSAGE") {
				var contentType = request.getItem('Content-Type').value;
				if (contentType == 'message/cpim') {
					// SMS Message or IMDN message
					var bodyContentType = this.parseGetMessageContentType(request.body);
					console.info("received request bodyContentType: " + bodyContentType);
					if (bodyContentType.trim() === 'message/imdn+xml'){
						this.receivedSmsIMDNMessage(ua, request);// receive imdn message
					} else {
						this.receivedSmsMessage(ua, request);// receive sms message
					}
				} else {
					this.receivedPageModeChatMessage(ua, request);
				}				
			} else {
				console.warn("Session.receivedRequest() ignoring received request [method= " + method + ", callID = " + request.getItem("call-id").value + "]");
				if (method !== 'ACK') {
					ua.sendResponse(ua.createResponse(501, "Not Implemented"));
				}
			}
		};

		/**
		* @summary Receives a SIP REGISTER response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedRegisterResponse = function (ua, response) {
			console.debug("\n[" + new Date().toUTCString() + "] " + "sipAdapter.receivedRegisterResponse() ua=" + ua);

			if ( response.response != 408 )
			{
				// A register response has been received so release the response timer
				console.log( "Clearing registration response timer" );
				clearTimeout( this.registerResponseTimer );
			}

			var event, i_expires, refresh_time, min_expires, i, contact;
			if (response.isfinal()) {
				if (response.is2xx()) {
					if (this.session.sessionStatus === SessionStatus.CONNECTING || this.refreshInProgress) {

						if (!this.savedCallId) {
							if (response.hasItem("call-id")) {
								this.savedCallId = response.getItem("call-id").value;
								console.debug("Saving initial register call id = " + this.savedCallId);
							}
						}
						if (this.refreshInProgress) {
							this.refreshInProgress = false;
							console.debug("Register refresh completed successfully");
							if ( this.session.sessionStatus != SessionStatus.CONNECTED )
							{
								// We now have a successful register response on a refresh so update the	
								// the session status if it isn't set to connected
								console.debug("Setting session status to connected");
								this.setSessionStatus(SessionStatus.CONNECTED);
							}
						}
						else {
							this.setSessionStatus(SessionStatus.CONNECTED);
						}

						// Check to see if expires header is present
						if (response.hasItem("expires").value) {
							i_expires = parseInt(response.getItem("expires").value);
						} else {
							// Expires header not present, check contact
							contact = response.getItem("contact");
							if (contact instanceof Array) {
								i_expires = this.sessionExpires;
								for (i = 0; i < contact.length; i += 1) {
									if (contact[i]['+sip.instance'] === this.instanceId) {
										i_expires = parseInt(contact[i].expires);
										break;
									}
								}
							} else {
								i_expires = parseInt(contact.expires);
							}
						}
						console.debug("i_expires = " + i_expires);

						if (i_expires > 0) {

							// Calculate the refresh time.  Per 3GPP TS 24.229 it should be 600 seconds before the expiration
							// time if the initial registration was for greater than 1200 seconds, or when half of the time has
							// expired if the initial registration was for 1200 seconds or less.

							if (i_expires > 1200) {
								refresh_time = i_expires - 600;
							} else {
								refresh_time = i_expires / 2;
							}
							// If static register refresh time is specified 
							// for service continuity then overwrite
							// the refresh time
							if ( this.config.providerConfig.registerRefreshTime > 0 )
							{
								refresh_time = this.config.providerConfig.registerRefreshTime; 
							}
							console.debug("refresh_time = " + refresh_time);
							var self = this;
							this.refresh_timer = setTimeout(function () { self.register_refresh(); }, refresh_time * 1000);
						} else {
							// report error and return
							console.debug("invalid i_expires = " + i_expires);
							return;
						}
					} else if (this.session.sessionStatus === SessionStatus.CONNECTED) {
						this.setSessionStatus(SessionStatus.DISCONNECTED);
						this.ws.close();
					} else {
						console.warn("Session.receivedRegisterResponse() Ignore SIP REGISTER response (session status = " + this.session.sessionStatus + ")");
					}

					if ( this.session.mdsp.isFeatureEnabled() )
					{
						this.processMDSPContactHeaders( response);
					}
				} else {
					console.debug("Session.receivedRegisterResponse() failed response = " + response.response + " " + response.responsetext);
					if (response.response == 423) {
						// extract min-expires header value
						min_expires = response.getItem("min-expires").value;
						this.sessionExpires = min_expires;
						console.debug("Re-trying register with expires = " + min_expires);
						this.register();
						return;
					}

					if ( response.response == 408 ) {
						if ( this.timeouts_allowed > 0 )
						{
							// Ignore timeout that could be for a 
							// register sent during network outage
							this.session.timeouts_allowed --;
							return;
						}
					}
					if (response.response == 403) {
						if (this.token.authtype === "SSO-Auth") {
						   console.debug("receive 403 response and authtype is SSO Auth, set sessionStatus to AUTHENTICATING");
						   this.setSessionStatus(SessionStatus.AUTHENTICATING);
						   return;
						}
					}

					// this.authenticate() return false results in 401 response going here 
					if(this.session.sessionStatus === SessionStatus.AUTHENTICATING){
						console.debug("sessionStatus == SessionStatus.AUTHENTICATING, don't set SessionError.AUTHENTICATION_FAILED");
					} else {
						this.setSessionStatus(SessionStatus.DISCONNECTED, SessionError.AUTHENTICATION_FAILED);
					}
				}
			}
		};

		this.processMDSPContactHeaders = function( response) {
			console.debug("sipAdapter.processMDSPContactHeaders()\n");
			var i;
			var gruu;
			var sipUri;
			var displayName;
			var isSecondaryDevice;
			var updateIndicationNeeded = false;
			var c = response.getItem("contact");
			var contact = [];

			if ( ( c instanceof Array ) == false )
			{
				/*
				 *  Convert to array so that it can be processed
				 *  in the for-loop below and we can save our own GRUU.
				 */
				contact.push( c);
			}
			else {
				console.debug("array of Contact Headers found.\n");
				contact = c;
			}

			for ( i = 0 ; i < contact.length ; ++i )
			{
				gruu = '';
				sipUri = '';
				displayName = '';
				isSecondaryDevice = false;

				if ( contact[i].value.displayName != undefined )
				{
					console.debug("contact["+i+"].displayName = " + contact[i].value.displayName);
					displayName = contact[i].value.displayName;
				}

				/* Extract the GRUU and sip URI from the Contact Header */
				if ( contact[i]['pub-gruu'] != undefined )
				{
					gruu = this.getGruuFromPubGruu( contact[i]['pub-gruu']);
					sipUri = this.getSipUriFromPubGruu( contact[i]['pub-gruu']);
					console.debug("contact["+i+"].pub-gruu = " + contact[i]['pub-gruu']);
					this.session.mdsp.setGRUUsupport( true);
				}
				else if ( contact[i]['+sip.instance'] != undefined )
				{
					// Code to be added to get gruu from sip.instance
					// and get sipUri from Contact Header.
					var si = contact[i]['+sip.instance'];
					console.debug("contact["+i+"].+sip.instance = " + si);

					if (   ( contact[i].value.uri.scheme != undefined )
					    && ( contact[i].value.uri.user != undefined )
					    && ( contact[i].value.uri.host != undefined ) )
					{
						/* Looks like we can build a sipUri */
						var s = contact[i].value.uri.scheme;
						var u = contact[i].value.uri.user;
						var h = contact[i].value.uri.host;

						sipUri = s + ':' + u + '@' + h;
						if ( contact[i].value.uri.port != undefined )
						{
							sipUri = sipUri + ':' + contact[i].value.uri.port.toString();
						}
						console.debug("contact["+i+"].(constructed sipUri) = " + sipUri);
					}
					gruu = si.substring( 1, si.length - 1);
					console.debug("contact["+i+"].(constructed gruu) = " + gruu);
					this.session.mdsp.setGRUUsupport( false);
				}
				else
				{
					console.debug("contact["+i+"] bears neither pub-gruu nor +sip.instance.\n");
					continue;
				}

				/*
				 *  If the contact header carries a property identifying this
				 *  contact as a secondary device then save this.
				 *  Knowing that this contat is a secondary device may later
				 *  be relevent when a 'Pull' call operation is performed
				 *  since a 'dialog event based pull' will use a different 'To: URI'
				 *  depending on whether the device is a secondary or the main device.
				 */
				if (   ( contact[i]['+g.gsma.rcs.ipcall'] != undefined )
				    || (   ( contact[i].mobility != undefined )
					&& ( contact[i].mobility == "fixed" ) ) )
				{
					isSecondaryDevice = true;
				} 

				if ( this.session.mdsp.addContact( gruu, sipUri, displayName, isSecondaryDevice) )
				{
					updateIndicationNeeded = true;
				}
			}

			if ( updateIndicationNeeded )
			{
                                setTimeout( this.session.mdsp.subscribeToMDSPContactDialogs.bind(this.session.mdsp), 2000);
				this.session.mdsp.onContactsUpdate();
			}
		};

		this.getGruuFromPubGruu = function( pubGruu) {
			/*
			 *  pubGruu is a string such as,
			 *    sip:+16309793094@demo.alcatel-lucent.com;gr=urn:uuid:edc1eb3a-a9f7-4809-b196-00fd2f6be7e0
			 *  Note that it will not be delimited in double quotes
			 *  as it is found in a Contact Header.
			 *  This function will parse the string and return the gruu,
			 *    urn:uuid:edc1eb3a-a9f7-4809-b196-00fd2f6be7e0
			 */
			pubGruu = pubGruu.split(';gr=');
			if ( pubGruu.length != 2 )
			{
				console.debug('Invalid pub-gruu received.  Unable to extract GRUU. pub-gruu="' + pubGruu + '"');
				return ( "GRUU-Unknown");
			}
			return ( pubGruu[1]);
		};

		this.getSipUriFromPubGruu = function( pubGruu) {
			/*
			 *  pubGruu is a string such as,
			 *    sip:+16309793094@demo.alcatel-lucent.com;gr=urn:uuid:edc1eb3a-a9f7-4809-b196-00fd2f6be7e0
			 *  Note that it will not be delimited in double quotes
			 *  as it is found in a Contact Header.
			 *  This function will parse the string and return the sip-uri,
			 *    sip:+16309793094@demo.alcatel-lucent.com
			 */
			pubGruu = pubGruu.split(';gr=');
			if ( pubGruu.length != 2 )
			{
				console.debug('Invalid pub-gruu received.  Unable to extract sip-uri. pub-gruu="' + pubGruu + '"');
				return ( "sip-uri-Unknown");
			}
			return ( pubGruu[0]);
		};

		this.sendSubscribeDialog = function( sipUri) {
			console.debug('sendSubscribeDialog(), sipUri = <' + sipUri + '>');
			var uaCall, request, c;

			uaCall = new sip.UserAgent( this.stack);
			uaCall.remoteParty = new sip.Address( sipUri);
			uaCall.localParty = new sip.Address( this.localAOR);
			request = uaCall.createRequest('SUBSCRIBE');

			c = this.createContactHeader( 'SUBSCRIBE');
			request.setItem('Contact', c);

			request.setItem('Event', new sip.Header('dialog', 'Event'));
			request.setItem('Supported', new sip.Header('gruu','Supported'));
			
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			request.setItem('Expires', new sip.Header( '3600', 'Expires'));

			uaCall.sendRequest(request);
		};

 		/**
		* @summary Receives a SIP SUBSCRIBE Response. See RFC3903.
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedSubscribeDialogResponse = function (ua, response) {
			console.debug("Session.receivedSubscribeDialogResponse() response " + response.response);
		};

		/**
		 * @summary Receives a SIP DIALOG NOTIFY request
		 * @param {sip.UserAgent} ua User agent instance
		 * @param {sip.Message} request SIP request
		 * @private
		 */
		this.receivedDialogNotify = function (ua, request) {
			var response = ua.createResponse( 200, 'OK');
			var contact = this.createContactHeader( '200 OK');
			response.setItem( 'Contact', contact);
			response.setItem( 'User-Agent', new sip.Header( this.userAgent, 'User-Agent'));
			ua.sendResponse( response);
			this.session.mdsp.onDialogNotify( request.body);
		};

		/**
		* @summary Authenticates the web user.
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.header} header SIP Header
		* @param {sip.Stack} stack SIP stack
		* @private
		*/
		this.authenticate = function (ua, header, stack) {
			console.debug("authenticate() username = " + this.token.id + ", password = " + this.token.key + ", authtype = " + this.token.authtype);
			if (this.token.authtype === "Token-Auth") {
				this.setSessionStatus(SessionStatus.AUTHENTICATING);
				return false;
			} else {
				header.username = this.token.id;
				header.password = this.token.key;
				if ( !(header.hasItem('algorithm')) )
				{
					header.algorithm = "MD5";
				}
				return true;
			}
		};


		/**
		* @summary Creates an UAS instance.
		* @param {sip.Message} request received request
		* @param {sip.URI} uri SIP URI
		* @param {sip.Stack} stack SIP stack
		* @private
		*/
		this.createServer = function (request, uri, stack) {
			console.debug("createServer() create new UAS instance for method = " + request.method);
			return (request.method !== "CANCEL" ? new sip.UserAgent(stack, request) : null);
		};


		/**
		* @summary A SIP Dialog has been created. User agent becomes Dialog
		* @param {sip.Dialog} dialog SIP dialog
		* @param {sip.UserAgent} ua SIP user agent
		* @param {sip.Stack} stack SIP stack
		* @private
		*/
		this.dialogCreated = function (dialog, ua, stack) {
			var callId, call;
			callId = dialog.callId;
			call = this.session.getCall(callId);
			if (call !== null) {
				//call.dialogCreated(dialog, ua);
				if (ua === call.uaCall) {
					call.uaCall = dialog;
				}
			} else {
				console.warn("Session.dialogCreated() A dialog has been created but it's not linked with any created Call instance");
			}
		};

		/**
		* @summary SIP request has been canceled.
		* @param {sip.UserAgent} ua SIP user agent
		* @param {sip.Message} request SIP request
		* @param {sip.Stack} stack SIP stack
		* @private
		*/
		this.cancelled = function (ua, request, stack) {
			console.debug("Session.cancelled()");
			var callId, call;
			callId = request.getItem("call-id").value;
			call = this.getCall(callId);
			if (call !== null) {
				call.cancelled(ua, request, stack);
			} else {
				console.warn("Session.canceled() A request has been canceled, but it's not linked with any created Call instance");
			}
		};

		/**
		* Send a DTMF tone using SIP INFO method.
		* @param {string} dtmf The DTMF tone to send
		*/
		this.sendDTMFSip = function (call, dtmf) {
			var allowed, request, contact;
			console.debug("sendDTMFSip " + dtmf);
			
			var dtmfDuration = call.session.config.providerConfig.dtmfDuration;
			console.debug("sendDTMFSip dtmfDuration: " + dtmfDuration);
			
			if (call.uaCall) {
				if (typeof dtmf !== 'string' || dtmf.length !== 1) {
					console.error('sendDTMFSip() Input must be a single DTMF character.');
					return;
				}
				allowed = '1234567890#*ABCDabcd';
				if (allowed.indexOf(dtmf) < 0) {
					console.error('sendDTMFSip() Character "' + dtmf + '" is not a DTMF tone, ignoring.');
					return;
				}
				request = call.uaCall.createRequest('INFO');
				contact = this.createContactHeader( 'INFO');
				request.setItem('Contact', contact);
				if (this.userAgent) {
					request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
				}
				request.setItem('Content-Type', new sip.Header("application/dtmf-relay", 'Content-Type'));
				body = "Signal=" + dtmf + "\r\n";
				body = body + "Duration=" + dtmfDuration + "\r\n";
				request.setBody(body);
				call.uaCall.sendRequest(request);
			}
		};

		/*
		 * Called to do dns resolution.  For now just provide the websocket ip address.
		 *
		 */
		this.resolve = function (host, type, callback, stack) {
				console.debug("Entered resolve() host = " + host + " type = " + type);

				var slash_position = this.config.uri.lastIndexOf("//");
				if (slash_position > -1) {
					slash_position += 1;
				}
				var colon_position = this.config.uri.lastIndexOf(":");
				var ip_address = this.config.uri.substring(slash_position + 1, colon_position);
				console.debug("resolve() ip_address = " + ip_address);

				dns_candidate = new Object();
				dns_candidate.address = ip_address;
				var values = new Array();
				values[0] = dns_candidate;
				callback(host, values);
		};

		/**
		* @summary Sends a SIP request MESSAGE to the chatee.
		*/
		this.sendPageModeChatMessage = function (call, dest, message) {
			var uaCall, request, contact, rls, idx, mtp;
			uaCall = new sip.UserAgent(this.stack);
			if (dest.length === 1) {
				uaCall.remoteParty = new sip.Address(dest[0]);
			} else {
				uaCall.remoteParty = new sip.Address(this.session.config.providerConfig.conferenceFactoryURI);
			}
			uaCall.localParty = new sip.Address(this.localAOR);
			if (this.config.providerConfig.breaker) {
				uaCall.breaker = true;
			}
			
			request = uaCall.createRequest('MESSAGE');
			call.callId = request.getItem("call-id").value;
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.setItem('gr', this.session.instanceId);
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			if (dest.length === 1) {
				// we have a unique callee
				request.setItem('Content-Type', new sip.Header("text/plain", 'Content-Type'));
				request.setBody(message);
			//    callParams.isConferenceCall = false;
			} else {
				rls = new ResourceList();
				for (idx=0; idx<dest.length; idx+=1) {
					rls.addResource({uri:dest[idx]});
				}
				// conferenceParams.rls = rls;
				// callParams.isConferenceCall = true;
				// we have to establish a conference call
				mtp = new Multipart();
				mtp.addPart({contentType:"text/plain", data:message});
				mtp.addPart({contentType:"application/resource-lists+xml", contentDisposition:"recipient-list", data:rls.toString()});
				request.setItem('Content-Type', new sip.Header('multipart/mixed;boundary='+ mtp.getBoundary(), 'Content-Type'));
				request.setItem('Require', new sip.Header("recipient-list-invite", 'Require'));
				request.setBody(mtp.toString());
				//this.isTiledVideo = this.mediaTypes.indexOf('video') > -1;
			}

			uaCall.sendRequest(request);
		};
		
		/**
		* @summary Sends a SIP request MESSAGE to the chatee.
		*/
		this.sendSmsMessage = function (call, dest, imdnMessageID, dateTime, message) {
			console.info('sipAdapter.sendSmsMessage');
			var uaCall, request, contact, rls, idx, mtp;
			uaCall = new sip.UserAgent(this.stack);
			if (dest.length === 1) {
				uaCall.remoteParty = new sip.Address(dest[0]);
			} else {
				uaCall.remoteParty = new sip.Address(this.session.config.providerConfig.conferenceFactoryURI);
			}
			uaCall.localParty = new sip.Address(this.localAOR);
			if (this.config.providerConfig.breaker) {
				uaCall.breaker = true;
			}
			
			request = uaCall.createRequest('MESSAGE');
			call.callId = request.getItem("call-id").value;
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.setItem('gr', this.session.instanceId);
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			
			var messageBody = '';
			//var dateTime = new Date().toUTCString();
			messageBody += 'From: <' + this.localAOR +'>\r\n';
			messageBody += 'To: <' + dest[0]+'>\r\n';
			messageBody += 'DateTime:' + dateTime +'\r\n';
			messageBody += 'NS: imdn <urn:ietf:params:imdn>\r\n';
			messageBody += 'imdn.Message-ID:'+ imdnMessageID + '\r\n';
			messageBody += 'imdn.Disposition-Notification: positive-delivery, negative-delivery\r\n';
			messageBody += 'Content-type: text/plain\r\n';
			messageBody += 'Content-Length:' + message.length + '\r\n\r\n';
			messageBody += message +'\r\n';
			console.info(messageBody.length);

			if (dest.length === 1) {
				// we have a unique callee
				request.setItem('Content-Type', new sip.Header("message/cpim", 'Content-Type'));
				request.setBody(messageBody);
			} else {
				console.info('multiple dest');
			}
			uaCall.sendRequest(request);
		};
		
		this.sendSmsIMDNMessage = function (call, dest, imdnMessageID, status, dateTime) {
			console.info('sipAdapter.sendSmsIMDNMessage');
			var uaCall, request, contact, rls, idx, mtp;
			uaCall = new sip.UserAgent(this.stack);
			if (dest.length === 1) {
				uaCall.remoteParty = new sip.Address(dest[0]);
			} else {
				uaCall.remoteParty = new sip.Address(this.session.config.providerConfig.conferenceFactoryURI);
			}
			uaCall.localParty = new sip.Address(this.localAOR);
			if (this.config.providerConfig.breaker) {
				uaCall.breaker = true;
			}
			
			request = uaCall.createRequest('MESSAGE');
			call.callId = request.getItem("call-id").value;
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.setItem('gr', this.session.instanceId);
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			
			var indexStr = this.localAOR.indexOf(":");
			var recipientUri = '';
			if (indexStr >= 0) {
				recipientUri = "im:" + this.localAOR.substr(indexStr + 1);
			} else {
				recipientUri = "im:" + this.localAOR;
			}
			
			var message = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n"
					+"<imdn xmlns=\"urn:ietf:params:xml:ns:imdn\">\r\n"
					+"<message-id>" + imdnMessageID + "</message-id>\r\n"
					+"<datetime>" + dateTime + "</datetime>\r\n"
					+"<recipient-uri>" + recipientUri + "</recipient-uri>\r\n"
					+"<original-recipient-uri>" + recipientUri + "</original-recipient-uri>\r\n"
					+"<delivery-notification>\r\n" 
					+"<status>" + "<" + status + "/>" +"</status>\r\n"
					+"</delivery-notification>\r\n"
  			        +"</imdn>\r\n";  			
 			
			var messageBody = '';
			messageBody += 'From: <' + this.localAOR +'>\r\n';
			messageBody += 'To: <' + dest[0]+'>\r\n';
			messageBody += 'NS: imdn <urn:ietf:params:imdn>\r\n';
			messageBody += 'imdn.Message-ID:'+ imdnMessageID +'\r\n';
			messageBody += 'Content-type: message/imdn+xml\r\n';
			messageBody += 'Content-Disposition: notification\r\n';			
			messageBody += 'Content-Length:' + message.length + '\r\n\r\n';
			messageBody += message +'\r\n';
			console.info(messageBody.length);

			if (dest.length === 1) {
				// we have a unique callee
				request.setItem('Content-Type', new sip.Header("message/cpim", 'Content-Type'));
				request.setBody(messageBody);
			//    callParams.isConferenceCall = false;
			} else {
				console.info('multiple dest');
			}

			uaCall.sendRequest(request);
		};
		
		 /**
		 * @summary Creates and sends a SIP request for presence.
		 * @private
		 */
		this.sendUpdatePresence = function (presenceInfo, isRetry, isNextUpdate, isRemove) {
			var uaCall, request, contact, xml;
			clearTimeout(this.presenceRefreshTimer);
			if (isRetry && this.presencePendingUpdates.length > 0) {
				return;
			}
			
			if (isRemove && !this.presenceEtag) {
				return;
			}
			
			if (presenceInfo === true) {
				console.info('sendUpdatePresence() Use a default online presence XML');
				presenceInfo = '<?xml version="1.0" encoding="UTF-8"?>\r\n'
					+ '<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="' + this.localAOR + '">\r\n'
						+ '\t<tuple id="orca1">\r\n'
							+ '\t\t<status>\r\n'
								+ '\t\t\t<basic>open</basic>\r\n'
							+ '\t\t</status>\r\n'
							+ '\t\t<contact priority="0.8">' + this.localAOR + '</contact>\r\n'
							+ '\t\t<note xml:lang="en">Logged in with Orca ALU</note>\r\n'
							+ '\t\t<timestamp>' + (new Date()).toISOString() + '</timestamp>\r\n'
						+ '\t</tuple>\r\n'
					+ '</presence>\r\n';
			} else if (presenceInfo === false) {
				console.info('sendUpdatePresence() Use a default offline presence XML');
				presenceInfo = '<?xml version="1.0" encoding="UTF-8"?>\r\n'
					+ '<presence xmlns="urn:ietf:params:xml:ns:pidf" entity="' + this.localAOR + '">\r\n'
						+ '\t<tuple id="orca1">\r\n'
							+ '\t\t<status>\r\n'
								+ '\t\t\t<basic>closed</basic>\r\n'
							+ '\t\t</status>\r\n'
							+ '\t\t<contact priority="0.8">' + this.localAOR + '</contact>\r\n'
							+ '\t\t<note xml:lang="en">Logged in with Orca ALU</note>\r\n'
							+ '\t\t<timestamp>' + (new Date()).toISOString() + '</timestamp>\r\n'
						+ '\t</tuple>\r\n'
					+ '</presence>\r\n';
			}
			this.presencePendingUpdates.push(presenceInfo);
			if (!isNextUpdate && this.presencePendingUpdates.length > 1) {
				return; // wait in queue
			}

			uaCall = new sip.UserAgent(this.stack);
			uaCall.remoteParty = new sip.Address(this.localAOR);
			uaCall.localParty = new sip.Address(this.localAOR);
			request = uaCall.createRequest('PUBLISH');
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.value.uri.param.gr = this.session.mdsp.myOwnGruu;
			request.setItem('Contact', contact);
			request.setItem('Event', new sip.Header('presence', 'Event'));
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			request.setItem('Content-Type', new sip.Header(('' + presenceInfo).toLowerCase().indexOf('pidf-diff') > -1
					? 'application/pidf-diff+xml' : 'application/pidf+xml', 'Content-Type'));
			if (this.presenceEtag) {
				request.setItem('SIP-If-Match', new sip.Header(this.presenceEtag, 'SIP-If-Match'));
			}
			if (presenceInfo) {
				request.setBody(presenceInfo);
			}
			if (!isRetry && this.presenceEtag) {
				// Remove presence state. Etag becomes invalid.
				//request.setItem('Expires', new sip.Header('0', 'Expires'));
				this.presenceEtag = undefined;
			}
			if (isRemove) {
				request.setItem('Expires', new sip.Header('0', 'Expires'));
			} else if (this.presenceExpires > 0) {
				// Set preferred interval. If Expires header is omitted, the server will set an interval.
				request.setItem('Expires', new sip.Header('' + this.presenceExpires, 'Expires'));
			}
			uaCall.sendRequest(request);
		};

 		/**
		* @summary Receives a SIP PUBLISH Response. See RFC3903.
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedUpdatePresenceResponse = function (ua, response) {
			console.debug("Session.receivedUpdatePresenceResponse() response " + response.response);
			var lastUpdate = this.presencePendingUpdates.shift(), self = this, item, expires = 0;
			if (lastUpdate === undefined) {
				console.warn('receivedUpdatePresenceResponse() Original request not found');
				lastUpdate = '';
			}
			if (response.is2xx()) {
				// Success
				item = response.getItem('SIP-ETag');
				if (item) {
					this.presenceEtag = item.value;
				} else {
					this.presenceEtag = undefined;
				}
				item = response.getItem('Expires');
				if (item) {
					expires = parseInt(item.value);
					if (expires > 0) {
						this.presenceExpires = expires;
					}
				}
				if (expires > 0 && this.presencePendingUpdates.length === 0) {
					// Refresh publication before it expires
					this.presenceRefreshTimer = setTimeout(function () {
						self.sendUpdatePresence('', true);
					}, ((expires > 1200) ? (expires - 600): (expires / 2)) * 1000);
				}
				this.session.onUpdatePresenceSuccess({name: SessionStatus.UPDATEPRESENCESUCCESS, content: lastUpdate});
			} else {
				// Failure
				if (this.presencePendingUpdates.length === 0) {
					//for issue 116250, the blank custom XML got infinite loop here.
					//But why blank content got 412 is still unknown and waits for Marvin's help to collect
					//IMS side log to analyse. The message is not forwarded to PS server.
					if (response.response === 412 && this.presenceEtag != undefined) {
						// Etag invalid. Try again without etag.
						this.presenceEtag = undefined;
						this.sendUpdatePresence(lastUpdate, true);
						return;
					}
					if (response.response === 423) {
						// Interval too brief. Try again with longer interval.
						this.presenceExpires = parseInt(response.getItem('Min-Expires').value);
						this.sendUpdatePresence(lastUpdate, true);
						return;
					}
				}
				this.session.onUpdatePresenceFail({name: SessionStatus.UPDATEPRESENCEFAIL, content: lastUpdate});
			}
			// Next in queue
			if (this.presencePendingUpdates.length > 0) {
				this.sendUpdatePresence(this.presencePendingUpdates[0], false, true);
			}
		};
		
		 /**
		 * @summary Creates and sends a SIP SUBSCRIBE request for presence.
		 * @private
		 */
		this.sendSubscribePresence = function (presenceResource, expires) {
			var uaCall, request, contact;

			uaCall = new sip.UserAgent(this.stack);
			uaCall.remoteParty = new sip.Address(presenceResource);
			uaCall.localParty = new sip.Address(this.localAOR);
			request = uaCall.createRequest('SUBSCRIBE');
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			request.setItem('Contact', contact);
			request.setItem('Event', new sip.Header('presence', 'Event'));
			//request.setItem('Accept', new sip.Header('application/pidf+xml, application/pidf-diff+xml', 'Accept'));
			//If the Accept and Supported header affect the subscribe to a presentity and a presentity list, this function needs
			//to be split for presentity and presentity list. application/rlmi+xml is for presentity list only.
			request.setItem('Accept', new sip.Header('application/rlmi+xml, application/pidf+xml, application/pidf-diff+xml', 'Accept'));
			request.setItem('Supported', new sip.Header('eventlist','Supported'));
			
			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			if (expires != undefined) {
				request.setItem('Expires', new sip.Header('' + expires, 'Expires'));
			} else {
				request.setItem('Expires', new sip.Header('' + this.presenceExpires, 'Expires'));
			}

			uaCall.sendRequest(request);
		};

 		/**
		* @summary Receives a SIP SUBSCRIBE Response. See RFC3903.
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedSubscribePresenceResponse = function (ua, response) {
			console.debug("Session.receivedSubscribePresenceResponse() response " + response.response);
			var expires = 0;
			var item = response.getItem('Expires');
			if (item) {
				expires = parseInt(item.value);
			}

			var event, from, to, callId, cSeq;
			from = response.getItem('From').value.uri.toString();
			to = response.getItem('To').value.uri.toString();
			callId = response.getItem('Call-ID').value;
			cSeq = response.getItem('CSeq').value;
			console.log("receivedSubscribePresenceResponse(). from: " + from + ", to: " + to + ", callId: " + callId + ", cSeq: " + cSeq);
			event = {responseCode: response.responseText, from: from, to: to, callId: callId, cSeq: cSeq, expires: expires};

			if (response.is2xx()) {
				if (expires > 0) {
					this.session.onSubscribePresenceSuccess(event);
				} else {
					this.session.onGetPresenceSuccess(event);
				}
			} else {
				// Failure
				if (expires > 0) {
					this.session.onSubscribePresenceFailed(event);
				} else {
					this.session.onGetPresenceFailed(event);
				}
			}
		};
		
		/**
		 * @summary Receives a SIP PRESENCE NOTIFY request
		 * @param {sip.UserAgent} ua User agent instance
		 * @param {sip.Message} request SIP request
		 * @private
		 */
		this.receivedPresenceNotify = function (ua, request) {
			var from, to, callId, cSeq;
			from = request.getItem('From').value.uri.toString();;
			to = request.getItem('To').value.uri.toString();;
			callId = request.getItem('Call-ID').value;
			cSeq = request.getItem('CSeq').value;
			var subscribiption = this.session.getPresenceSubscription(from, callId, cSeq);
			if(!subscribiption){
				console.warn('receivedPresenceNotify() no subscribe found');
				ua.sendResponse(ua.createResponse(481, 'Subscription does not exist'));
			} else {
				var response = ua.createResponse(200, 'OK');
				contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
				response.setItem('Contact', contact);
				response.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
				ua.sendResponse(response);
				var event, subscriptionState, contentLength, contentType = null, type, boundary;
				subscriptionState = request.getItem('Subscription-State').value;
				var contentLength = parseInt(request.getItem('Content-Length').value);
				if (contentLength > 0) {
					var contentTypeHeader = request.getItem('Content-Type');
					if (contentTypeHeader) {
						contentType = contentTypeHeader.value;
						type = contentTypeHeader.type;
						boundary = contentTypeHeader.boundary;
					}
				} 
				event = {from: from, to: to, callId: callId, cSeq: cSeq, subscriptionState: subscriptionState, contentLength: contentLength, contentType: contentType, contentType_type: type, boundary: boundary};
				this.session.onPresenceNotify(request.body, event);
			}
		};

		/**
		 * @summary Creates and sends a SIP INVITE request.
		 * @param {string} sdp SDP offer
		 * @private
		 */
		this.createAndSendInviteRequest = function (call, dest, sdp) {
			console.debug("Call.createAndSendInviteRequest()");
			var request, contact, rls, idx, mtp;

			if ( call.pullCallInfo != undefined )
			{
				dest.length = 0;
				dest.push( call.session.mdsp.getToUriForPull( call.pullCallInfo));
			}

			if (call.uaCall === null) {
				call.uaCall = new sip.UserAgent(this.stack);
				if (dest.length === 1) {
					call.uaCall.remoteParty = new sip.Address(dest[0]);
				} else {
					call.uaCall.remoteParty = new sip.Address(this.session.config.providerConfig.conferenceFactoryURI);
				}
				call.uaCall.localParty = new sip.Address(this.localAOR);
				//this.uaCall.routeSet = [this.getRouteHeader()];
				if (this.config.providerConfig.breaker) {
					call.uaCall.breaker = true;
				}
			}

			if ( call.restoredCall )
			{
				// If this is a re-invite for a restored call, update the 
				// stack in the ua so we don't try to send out the 
				// re-invite on the old closed ws 
				call.uaCall.stack = this.stack;
			}

			request = call.uaCall.createRequest('INVITE');
			if ( call.pullCallInfo != undefined )
			{
				request.uri.user = call.session.mdsp.getRequestUriUserForPull();
			}
			call.callId = request.getItem("call-id").value;

			contact = this.createContactHeader( 'INVITE');
			request.setItem('Contact', contact);

			request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			if (sdp !== undefined) {

				if (dest.length === 1) {
					// we have a unique callee
					request.setItem('Content-Type', new sip.Header("application/sdp", 'Content-Type'));
					request.setBody(sdp);
				//    callParams.isConferenceCall = false;
				} else {
					rls = new ResourceList();
					for (idx=0; idx<dest.length; idx+=1) {
						rls.addResource({uri:dest[idx]});
					}
					// conferenceParams.rls = rls;
					// callParams.isConferenceCall = true;
					// we have to establish a conference call
					mtp = new Multipart();
					mtp.addPart({contentType:"application/sdp", data:sdp});
					mtp.addPart({contentType:"application/resource-lists+xml", contentDisposition:"recipient-list", data:rls.toString()});
					request.setItem('Content-Type', new sip.Header('multipart/mixed;boundary='+ mtp.getBoundary(), 'Content-Type'));
					request.setItem('Require', new sip.Header("recipient-list-invite", 'Require'));
					request.setBody(mtp.toString());
					//this.isTiledVideo = this.mediaTypes.indexOf('video') > -1;
				}
			}

			if ( call.pullCallInfo != undefined )
			{
				/*
				 *  Add a 'Replaces" header carrying the
				 *  call-ID of the call to be pulled.
				 */
				var pullFromCallId = call.session.mdsp.getReplacesUriForPull( call.pullCallInfo);
				request.setItem( 'Replaces', new sip.Header( pullFromCallId, 'Replaces'));
			}

			call.uaCall.sendRequest(request);
			//this.callStatus = this.CallStatus.CALLING;
		};

		/**
		 * @summary Creates and sends a SIP INVITE 200 OK response.
		 * @param {string} sdp SDP offer
		 * @private
		 */
		this.sendInviteResponse = function (call, code, status, sdp) {
			console.debug("sendInviteResponse()");
			if(!call.uaCall){
				console.error('uaCall is null');
				return;
			}
			if (code !== 200) {
				call.uaCall.sendResponse(call.uaCall.createResponse(code, status));
				//this.clean();
				return;
			}
			var response, contact;
			response = call.uaCall.createResponse(200, 'OK');
			contact = this.createContactHeader( '200 OK');
			response.setItem('Contact', contact);
			response.setItem('Content-Type', new sip.Header("application/sdp", 'Content-Type'));
			response.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			if (sdp !== undefined) {
				response.setItem('Content-Type', new sip.Header("application/sdp", 'Content-Type'));
				response.setBody(sdp);
			}
			call.uaCall.sendResponse(response);
		};

		/**
		 * @summary Creates and sends a SIP MESSAGE 200 OK response.
		 */
		this.sendPageModeChatMessageResponse = function (uaCall, code, status) {
			console.debug("sendMessageResponse()");
			if(!uaCall){
				console.error('uaCall is null');
				return;
			}

			if (code !== 200) {
				uaCall.sendResponse(uaCall.createResponse(code, status));
				return;
			}
			var response, contact;
			response = uaCall.createResponse(200, 'OK');
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.value.uri.param.gr = this.session.mdsp.myOwnGruu;
			response.setItem('Contact', contact);
			response.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			uaCall.sendResponse(response);
		};
		
		/**
		 * @summary Creates and sends a SIP MESSAGE 200 OK response.
		 */
		this.sendSmsMessageResponse = function (uaCall, code, status) {
			console.debug("sendSmsMessageResponse()");
			if(!uaCall){
				console.error('uaCall is null');
				return;
			}

			if (code !== 200) {
				uaCall.sendResponse(uaCall.createResponse(code, status));
				return;
			}
			var response, contact;
			response = uaCall.createResponse(200, 'OK');
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.value.uri.param.gr = this.session.mdsp.myOwnGruu;
			response.setItem('Contact', contact);
			response.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			uaCall.sendResponse(response);
		};
		
		/**
		 * @summary Creates and sends a SIP MESSAGE 200 OK response.
		 */
		this.sendSmsIMDNMessageResponse = function (uaCall, code, status) {
			console.debug("sendSmsIMDNMessageResponse()");
			if(!uaCall){
				console.error('uaCall is null');
				return;
			}

			if (code !== 200) {
				uaCall.sendResponse(uaCall.createResponse(code, status));
				return;
			}
			var response, contact;
			response = uaCall.createResponse(200, 'OK');
			contact = new sip.Header((new sip.Address(this.localAOR)).uri.toString(), 'Contact');
			contact.value.uri.param.gr = this.session.mdsp.myOwnGruu;
			response.setItem('Contact', contact);
			response.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));

			uaCall.sendResponse(response);
		};

		/**
		* @summary Creates a header 'Route' from the username, for a SIP messsage.
		* @param {string} username username
		* @returns {sip.Header}
		* @private
		*/
		this.getRouteHeader = function (username) {
			var outboundProxyAddress = this.config.uri.split('/')[2].trim() + ';transport=' + this.transport;
			return new sip.Header("<sip:" + (username ? username + "@" : "") + outboundProxyAddress + ";lr>", 'Route');
		};

		/**
		* @summary Receives a SIP INVITE request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} requset SIP request
		* @private
		*/
		this.receivedInvite = function (ua, request, callapi) {
			console.debug("Call.receivedInvite");
			var fromAddr = request.first('From').value.uri.toString();
			var evt = {name: 'invitation', callId: ua.callId, from: fromAddr, sdp: request.body, uaCall: ua, uaString: request.first('User-Agent').value };
			this.session.incomingSessionEvent(evt);
		};
		
		/**
		* @summary Receives a SIP MESSAGE request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} requset SIP request
		* @private
		*/
		this.receivedPageModeChatMessage = function (ua, request) {
			console.log("Call.received page mode chat message");
			var fromAddr = request.first('From').value.uri.toString();
			console.log("From: " + fromAddr);
			var evt = {name: 'message', callId: ua.callId, from: fromAddr, message: request.body, uaCall: ua, uaString: request.first('User-Agent').value, contentType: request.getItem('Content-Type').value };
			this.session.incomingSessionEvent(evt);
		};
		
		/**
		* @summary Receives a SIP SMS MESSAGE request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} requset SIP request
		* @private
		*/
		this.receivedSmsMessage = function (ua, request) {
			console.log("Call.receivedSmsMessage sms message");
			var fromAddr = request.first('From').value.uri.toString();
			//var fromAddr = this.parseGetMessageFrom(request.body);
			//var contact= request.getItem('contact');
			//console.log("contact: " + contact);
			var bodyMessage = this.parseGetMessageBody(request.body);
			console.log("From: " + fromAddr);
			console.log("message: " + bodyMessage);
			
			var imdnMessageID = this.parseGetMessageImdnID(ua.request.body);	
			var dateTime = this.parseGetMessageDateTime(ua.request.body);
			console.log("imdnMessageID: " + imdnMessageID);	
			console.log("dateTime: " + dateTime);
			
			var evt = {name: 'message', callId: ua.callId, from: fromAddr, message: bodyMessage, uaCall: ua, uaString: request.first('User-Agent').value, 
			contentType: request.getItem('Content-Type').value , bodyContentType: 'text/plain', imdnMessageID: imdnMessageID, dateTime: dateTime };
			this.session.incomingSessionEvent(evt);
		};

		/**
		* @summary Receives a SIP SMS MESSAGE request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} requset SIP request
		* @private
		*/
		this.receivedSmsIMDNMessage = function (ua, request) {
			console.log("Call.receivedSmsIMDNMessage sms imdn message");
			var fromAddr = request.first('From').value.uri.toString();
			console.log("From fromAddr: " + fromAddr);
			console.log("message: " + request.body);
			
			var messageBody = this.parseGetMessageBody(request.body);
			var smsImdnInfo = new Object();
  			this.parseElemImdnMessage(messageBody, smsImdnInfo);
  			console.log("xml messageId: " + smsImdnInfo.messageId);
			console.log("xml datetime: " + smsImdnInfo.datetime);
			console.log("xml status: " + smsImdnInfo.status);
			
			var evt = {name: 'message', callId: ua.callId, from: fromAddr, message: request.body, uaCall: ua, uaString: request.first('User-Agent').value, 
			contentType: request.getItem('Content-Type').value, bodyContentType: 'message/imdn+xml', messageBody: messageBody, imdnMessageID: smsImdnInfo.messageId, dateTime:smsImdnInfo.datetime, status: smsImdnInfo.status};
			this.session.incomingSessionEvent(evt);
		};
		
		this.parseElemImdnMessage = function(xmlstr, smsImdnInfo){
			if (window.DOMParser) {				
				var parser=new DOMParser();
				var xmlDoc=parser.parseFromString(xmlstr,"application/xml");				
			  	var messageId = xmlDoc.getElementsByTagName("message-id")[0].childNodes[0].nodeValue;
			  	var datetime = xmlDoc.getElementsByTagName("datetime")[0].childNodes[0].nodeValue;
			  	
			  	var element = xmlDoc.getElementsByTagName("status")[0];				  	
			  	this.cleanWhitespace(element);
			  	var status = "";			  	
			  	if(element.childNodes[0] instanceof Element){//no blank
			  		console.info("childNode is element"); 
			  		status = xmlDoc.getElementsByTagName("status")[0].childNodes[0].tagName;   					
   				} else if(element.childNodes[0] instanceof Text){//have blank
   					console.info("childNodes is text");   					   					
   				}			  				  	
				smsImdnInfo.messageId = messageId;
				smsImdnInfo.datetime = datetime;
				smsImdnInfo.status = status;;

			 	console.log("xml messageId: " + messageId);
			 	console.log("xml datetime: " + datetime);
			 	console.log("xml status: " + status);
			 
			}
		};
		
		this.cleanWhitespace = function(element) {
			for (var i = 0; i < element.childNodes.length; i++) {
				var node = element.childNodes[i];
				if (node.nodeType == 3 && !/\S/.test(node.nodeValue)) {
					node.parentNode.removeChild(node);
				}
			}
		};
		
		this.parseGetMessageBody = function(messageString) {
			var indexCRLFCRLF = messageString.indexOf("\r\n\r\n");
			var body = '';
			if (indexCRLFCRLF >= 0) {
				body = messageString.substr(indexCRLFCRLF + 4);
			}
			return body;
		};

		this.parseGetMessageFrom = function(messageString) {
			var indexFrom = messageString.indexOf("From:");
			var fromLine = '';
			var from = '';
			if (indexFrom >= 0) {
				fromLine = messageString.substr(indexFrom);
				var indexCRLF = fromLine.indexOf("\r\n");
				var fromStr = fromLine.substring(5, indexCRLF).trim();
				console.info("fromStr: " + fromStr);

				var indexLeftBracket = fromStr.indexOf("<");
				var indexRightBracket = fromStr.indexOf(">");
				if (indexLeftBracket >= 0) {
					from = fromStr.substring(indexLeftBracket + 1,
							indexRightBracket);
				} else {
					from = fromStr;
				}
			}
			return from;
		};

		this.parseGetMessageContentType = function(messageString) {
			var indexContentType = messageString.indexOf("Content-type:");
			var contentTypeLine = '';
			var contentType = '';
			if (indexContentType >= 0) {
				contentTypeLine = messageString.substr(indexContentType);
				var indexCRLF = contentTypeLine.indexOf("\r\n");
				contentType = contentTypeLine.substring(13, indexCRLF);
			}
			return contentType;
		};
		this.parseGetMessageImdnID = function(messageString) {
			var indexImdnMessageID = messageString.indexOf("imdn.Message-ID:");
			var imdnLine = '';
			var imdnMessageID = '';
			if (indexImdnMessageID >= 0) {
				imdnLine = messageString.substr(indexImdnMessageID);
				var indexCRLF = imdnLine.indexOf("\r\n");
				imdnMessageID = imdnLine.substring(16, indexCRLF);
			}
			return imdnMessageID;
		};
		this.parseGetMessageDateTime = function(messageString) {
			var indexDateTime = messageString.indexOf("DateTime:");
			var dateTimeLine = '';
			var dateTime = '';
			if (indexDateTime >= 0) {
				dateTimeLine = messageString.substr(indexDateTime);
				var indexCRLF = dateTimeLine.indexOf("\r\n");
				dateTime = dateTimeLine.substring(9, indexCRLF);
			}
			return dateTime;
		};

		/**
		* @summary Receives a SIP ACK request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} request SIP request
		* @private
		*/
		this.receivedAck = function (ua, request) {
			console.debug("Call.receivedAck()");
			var event;
			var call = this.session.getCall(ua.callId);
			if(call){
				if(request.body !== undefined && request.body !== null) {
					event = {name: 'confirmed', sdp: request.body};
				} else {
					event = {name: 'confirmed'};
				}
				call.incomingCallSessionEvent(event);
			}
		};

		/**
		 * @summary Receives a SIP INFO request
		 * @param {sip.UserAgent} ua User agent instance
		 * @param {sip.Message} request SIP request
		 * @private
		 */
		this.receivedInfo = function (ua, request) {
			console.debug("receivedInfo() auto respond");
			ua.sendResponse(ua.createResponse(200, 'OK'));
			//To reject content, respond 415, 'Unsupported Media Type'
		};

		/**
		 * @summary Receives a SIP NOTIFY request
		 * @param {sip.UserAgent} ua User agent instance
		 * @param {sip.Message} request SIP request
		 * @private
		 */
		this.receivedNotify = function (ua, request) {
			var call = this.session.getCall(ua.callId);
			if(!call){
				console.warn('receivedNotify() no call found');
				ua.sendResponse(ua.createResponse(200, 'OK'));
				return;
			}
			//if (this.call.uaCall && this.CallStatus != this.CallStatus.IDLE) {
				ua.sendResponse(ua.createResponse(200, 'OK'));
				var event = request.getItem('event').value;
				switch (event) {
					case "refer" :
						break;
					case "conference" :
						break;
					default:
						console.debug("receivedNotify() event not supported: " + event);
					break;
				}
			//}
		};

		/**
		* @summary Receives a SIP BYE request
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} request SIP request
		* @private
		*/
		this.receivedBye = function (ua, request) {
			console.debug("Call.receivedBye()");
			var call = this.session.getCall(ua.callId);
			if(!call){
				console.warn('receivedBye() no call found');
				return;
			}
			if (call.uaCall) {
				call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
				ua.sendResponse(ua.createResponse(200, 'OK'));
			}
		};

		/**
		* @summary Receives a SIP INVITE Response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedInviteResponse = function (call, ua, response) {
			console.debug("Call.receivedInviteResponse() response " + response.response);
			var event, sdp,remoteStream;
			if (response.is1xx()) {
				if (response.response !== 100) {
					console.debug("Call.receivedInviteResponse() Progressing [response = " + response.response + ", text = " + response.responsetext + "]");
					if (response.response >= 180) {
						event = {name: CallStatus.CONNECTING};
						call.ringingCallSessionEvent(event);
					}
				}
				return;
			}        
			if (!response.is2xx()) {
				event = {name:CallStatus.REJECTED};
				call.rejectedCallSessionEvent(event);
				return;
			}
			event = {name: CallStatus.CONNECTED};
			event.sdp = response.body;
			call.acceptedCallSessionEvent(event);
		};


		/**
		* @summary Receives a SIP MESSAGE Response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedPageModeMessageResponse = function (ua, response) {
			console.debug("Call.receivedPageModeMessageResponse() response " + response.response);
			event = {callId: ua.callId};
			if (!response.is2xx()) {
				this.session.onPageModeChatMessageFailed(event);
			} else {
				this.session.onPageModeChatMessageSent(event);
			}
		};
		
		/**
		* @summary Receives a SMS MESSAGE Response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedSmsMessageResponse = function (ua, response) {
			console.debug("Call.receivedSmsMessageResponse() response " + response.response);		
			var imdnMessageID = this.parseGetMessageImdnID(ua.request.body);
			var dateTime = this.parseGetMessageDateTime(ua.request.body);
			var from = response.getItem('From').value.uri.toString();
			var to = response.getItem('To').value.uri.toString();
			console.log("imdnMessageID: " + imdnMessageID);
			console.log("dateTime: " + dateTime);
			console.log("from: " + from);
			
			event = {callId: ua.callId, from: from, imdnMessageID: imdnMessageID, dateTime:dateTime};
			if (!response.is2xx()) {
				this.session.onSmsMessageFailed(event);
			} else {
				this.session.onSmsMessageSent(event);
			}
		};
		
		this.receivedSmsIMDNMessageResponse = function (ua, response) {
			console.debug("Call.receivedSmsIMDNMessageResponse() response " + response.response);
			
			var from = response.getItem('From').value.uri.toString();
			var to = response.getItem('To').value.uri.toString();
			console.log("from: " + from);
			
//			var imdnMessageID = this.parseGetMessageImdnID(ua.request.body);			
			var messageBody = this.parseGetMessageBody(ua.request.body);
			var smsImdnInfo = new Object();
  			this.parseElemImdnMessage(messageBody, smsImdnInfo);
  			console.log("imdnMessageID: " + smsImdnInfo.messageId);
			console.log("dateTime: " + smsImdnInfo.datetime);
			console.log("status: " + smsImdnInfo.status);
			
			event = {callId: ua.callId, from: from, imdnMessageID: smsImdnInfo.messageId, dateTime:smsImdnInfo.datetime, status: smsImdnInfo.status};
			if (!response.is2xx()) {
				this.session.onSmsIMDNMessageFailed(event);
			} else {
				this.session.onSmsIMDNMessageSent(event);
			}
		};
		

		/**
		* @summary Receives a SIP BYE Response
		* @param {sip.UserAgent} ua User agent instance
		* @param {sip.Message} response SIP response
		* @private
		*/
		this.receivedByeResponse = function (call, ua, response) {
			console.debug("receivedByeResponse()");
			// this.callStatusExternal = CallStatus.DISCONNECTED;
			// this.callStatus = this.CallStatus.CLOSED;
			var event = {name:CallStatus.DISCONNECTED};
			call.terminatedCallSessionEvent(event);
		};


		/**
		* @summary Send a SIP REFER to add or remove a conference participant
		* @param {String} uri User to add or remove
		* @param {boolean} isAdded True to add, false to remove
		* @private
		*/
		this.doRefer = function (call, uri, isAdded) {
			console.debug("doRefer() uri=" + uri + ", isAdded=" + isAdded);
			if (call.uaCall === null) {
				return;
			}
				
			var request = call.uaCall.createRequest('REFER');
			var contact = this.createContactHeader( 'REFER');
			request.setItem('Contact', contact);

			if (this.userAgent) {
				request.setItem('User-Agent', new sip.Header(this.userAgent, 'User-Agent'));
			}
			if (isAdded === true) {
				request.setItem('Refer-To', new sip.Header(uri, 'Refer-To'));
			} else {
				request.setItem('Refer-To', new sip.Header('<' + uri + ';method=BYE>', 'Refer-To'));
			}
			call.uaCall.sendRequest(request);
		};

		/**
		* @summary Send a SIP REFER to Push call to MDSP contact
		* @param {String} pushToUri uri associated with contact to which call will be 'Pushed'
		* @param {String} pushToGruu GRUU associated with contact to which call will be 'Pushed'
		* @private
		*/
		this.doPush = function( call, pushToUri, pushToGruu) {
			this.doRefer( call, '<' + pushToUri + ';gr=' + pushToGruu + '>', true);
		};

		/**
		* @summary SIP request has been canceled.
		* @param {sip.UserAgent} SIP user agent
		* @private
		*/
		this.cancelled = function (ua) {
			console.debug("Call.cancelled()");
			var call = this.session.getCall(ua.callId);
			if (call && call.uaCall && call.uaCall.servers[0] && ua === call.uaCall.servers[0].app) {
				call.incomingCallSessionEvent({name: 'canceled'});
			} else {
				console.warn("Call.canceled() Invalid User Agent for cancel");
			}
		};

		/**
		* @summary Sends a SIP CANCEL request.
		* @private
		*/
		this.cancel = function (call) {
			console.debug("Call.cancel()");
			if (call && call.uaCall) {
				call.uaCall.sendCancel();
				// this.callDirection = this.CallDirection.OUTGOING;
				// this.callStatus = this.CallStatus.CANCELING;
			} else {
				console.warn("Call.cancel() user agent is not instancied");
			}
		};

		/**
		* @summary Sends a SIP BYE request.
		* @private
		*/
		this.bye = function (call) {
			console.debug("bye()");
			if (call && call.uaCall) {
				var request = call.uaCall.createRequest('BYE');
				call.uaCall.sendRequest(request);
				//call.callStatus = this.CallStatus.TERMINATING;
			} else {
				console.warn("Call.bye() user agent is not instancied");
			}
		};

	};

	/**
	* @summary Manages a resources list for conference call.
	* @constructor
	* @param {string} XML resource list according to RFC5366.
	* @memberOf orca
	* @private
	*/
	function ResourceList(rls) {
		var copyControlTo = "to",
			copyControlCc = "cc",
			copyControlBcc = "bcc",
			resources = [];

		/**
		* @summary Parses a resource list XML string.
		* @param {string} XML string of the resource list.
		* @private
		*/
		this.parse= function (xmlstr)  {
			var idx, anonymized, resource, parser, xmlDoc, entries;
			if (window.DOMParser) {
			  parser = new DOMParser();
			  xmlDoc = parser.parseFromString(xmlstr,"text/xml");
			  entries = xmlDoc.getElementsByTagName("entry");
			  for (idx=0;idx<entries.length;idx+=1) {
				  anonymized = false;
				  if (entries[idx].getAttribute('cp:anonymize') === 'true') {
					  anonymized = true;
				  }
				  if (anonymized !== true) {
					  resource = {uri:entries[idx].getAttribute('uri'), copyControl:entries[idx].getAttribute('cp:copyControl'), anonymous:anonymized};
					  resources.push(resource);
				  }
			  }
			}
		};

		/**
		* @summary Adds a resource in the resource list.
		* @param {Object} resource Resource.
		* @param {string} uri Resource URI.
		* @param {string} copyControl copy control marker: 'to', 'cc' or 'bcc'. <strong>Optional</strong> (default value is 'to').
		* @param {Boolean} anonymous Anonymous flag. <strong>Optional</strong> (default value is false).
		* @private
		*/
		this.addResource = function (resource)  {
			if (resource.copyControl === undefined) {
				resource.copyControl = 'to';
			}

			if (resource.anonymous === undefined) {
				resource.anonymous = false;
			}
			resources.push(resource);
		};

		/**
		* @summary Gets the list of resources.
		* @private
		* @returns {Object[]}
		*/
		this.getResources = function ()  {
			return resources;
		};

		/**
		* @summary Deletes a resource in the resource list.
		* @private
		*/
		this.delResource = function (resource)  {
			var idx, uri;
			for(idx= 0; idx < resources.length; idx+=1) {
				uri  = resources[idx].uri;
				if (resource.uri === uri) {
				   resources.splice(idx,1);
				   return;
				}
			}
		};

		/**
		* @summary Returns a XML string representation of a resource list.
		* @returns {string}
		* @private
		*/
		this.toString = function ()  {
			var strdoc = '',
				xmldoc = this.toXML();

			if (xmldoc.xml) {
				strdoc = xmldoc.xml;
			} else {
				strdoc = (new XMLSerializer()).serializeToString(xmldoc);
			}

			return strdoc;
		};

		/**
		* @summary Returns XML document of the resource list.
		* @returns {XMLDocument}
		* @private
		*/
		this.toXML = function ()  {
			var data, xmlDoc, parser, idx, entry, uri, copyControl, anonymous, node;

			data = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>';
			data = data + '<resource-lists xmlns="urn:ietf:params:xml:ns:resource-lists" xmlns:cp="urn:ietf:params:xml:ns:copyControl">';
			data = data +  '<list>';
			data = data +  '</list>';
			data = data +  '</resource-lists>';

			if (window.DOMParser) {
				parser = new DOMParser();
				xmlDoc = parser.parseFromString(data,"text/xml");
			} else {
				// Internet Explorer
				xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
				xmlDoc.async=false;
				xmlDoc.loadXML(data);
			}

			for (idx= 0; idx < resources.length; idx += 1) {
				entry = xmlDoc.createElement('entry');
				uri = document.createAttribute('uri');
				uri.value = resources[idx].uri;
				entry.setAttributeNode(uri);
				copyControl = document.createAttribute('cp:copyControl');
				copyControl.value = resources[idx].copyControl;
				entry.setAttributeNode(copyControl);

				if (resources[idx].anonymous === true) {
					anonymous = document.createAttribute('cp:anonymize');
					anonymous.value = "true";
					entry.setAttributeNode(anonymous);
				}

				node = xmlDoc.getElementsByTagName("list")[0];
				node.appendChild(entry);
			}

			return xmlDoc;
		};

		if (rls !== undefined) {
			this.parse(rls);
		}
	};


	/**
	* @summary Creates a multi-parts content, according to RFC1521.
	* @constructor
	* @memberOf orca
	* @private
	*/
	function Multipart() {
		var boundary, parts = [];

		/**
		* @summary Create a boundary string.
		* @param {string} boundary string.
		* @private
		*/
		this.createBoundary = function () {
			var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz",
				string_length = 16,
				boundary = '',
				i, rnum;

			for (i=0; i<string_length; i+=1) {
				rnum = Math.floor(Math.random() * chars.length);
				boundary += chars.substring(rnum,rnum+1);
			}
			return boundary;
		};


		/**
		* @summary Returns the boundary string.
		* @return {string}
		* @private
		*/
		this.getBoundary = function () {
			return boundary;
		};

		/**
		* @summary Return the multi-parts content string data.
		* @return {string}
		* @private
		*/
		this.toString = function ()  {
			var mtp, idx;
			mtp = '';
			if (parts.length !== 0) {
				mtp = '--' + boundary + '\r\n';

				for(idx= 0; idx < parts.length; idx+=1) {
					mtp = mtp + 'Content-Type: ' + parts[idx].contentType;
					if (parts[idx].contentDisposition !== undefined) {
						mtp = mtp + '\r\nContent-Disposition: ' + parts[idx].contentDisposition;
					}
					mtp = mtp + '\r\n\r\n';
					mtp = mtp + parts[idx].data;

					if (idx === parts.length-1) {
						// it's the last part
						mtp = mtp + '\r\n--' + boundary + '--\r\n';
					} else {
						// it's not last part
						mtp = mtp + '\r\n--' + boundary + '\r\n';
					}
				}
			}
			return mtp;
		};

		/**
		* @summary Adds a part in the multi-parts content.
		* @param {Object} part Part
		* @param {string} part.contentType Part content type
		* @param {string} part.data Part data
		* @private
		*/
		this.addPart = function (part)  {
			var err;
			if (part.contentType === undefined) {
				err = new Error();
				err.message = "Content-Type not defined";
				throw err;
			}

			if (part.data === undefined) {
				err = new Error();
				err.message = "data not defined";
				throw err;
			}

			parts.push(part);
		};

		boundary = this.createBoundary();
	};
	
	function smsIMDNInfo(messageId, datetime, status) {
		this.messageId = messageId;
		this.datetime = datetime;
		this.status = status;
	};
	
	orcaALU.SipAdapter = SipAdapter;
}());
