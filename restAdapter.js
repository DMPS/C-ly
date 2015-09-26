(function () {  
	/**
	* @summary Accesses REST over websocket interface for session and call handling
	* @param {Userid} userid The user's unique identifier
	* @param {Token} token An authorization token associated with the provided userid
	* @param {SessionConfig} config session initialization parameters
	* @param {Session} session object to create the adapter
	*/
	function RestAdapter(websocket, userId, token, config, session) {
		var request = null;
		//var activeQuery = null;

		this.userId = userId;
		this.session = session;
		this.config = config;
		this.token = token;
		this.ws = websocket;

		//constant url for sending initial register and invite
		this.registerURL = '/vvoip/v1/user001/registrations';
		this.callURL = '/vvoip/v1/user001/sessions';
		
		/**
		* @summary Update token.key
		*/
		this.updateToken = function (tokenKey) {
			console.debug("restAdapter.updateToken");
			this.token.key = tokenKey;
		};
		
		/**
		* @summary Saved resource url from registration response and used to send active query  
		* @type {string}
		*/
		this.regResourceURL = null;

		/**
		* @summary Set session status to notify application  
		* @type {SessionStatus}
		*/
		this.setSessionStatus = function(status) {
			console.debug('RestAdapter.setSessionStatus() session status: ' + status);
			this.session.setSessionStatus(status);
		};

		/**
		* @summary Sends REST registration request  
		*/
		this.createSession = function() {
			console.debug("RestAdapter.createSession()");
			this.sendRegister();
			this.setSessionStatus(SessionStatus.CONNECTING);
		};

		/**
		* @summary Terminate REST registration by closing websocket  
		*/
		this.terminateSession = function() {
			console.debug("RestAdapter.terminateSession()");
			// REST interface does not require re-register nor un-register. Close websocket directly
			this.setSessionStatus(SessionStatus.DISCONNECTED);
			this.ws.close();
		};

		/**
		* @summary Creates and POSTs REST vviop call session
		* @param {string[]} dest list of user identifier of the call recipients  
		* @type {SessionStatus}
		*/
		this.createCallSession = function(call, dest, sdp, src) {
			console.debug("RestAdapter.createCallSession() to " + dest);
			if(dest.length === 1){
				this.createVvoipSession(call, dest[0], 'Anonymous', sdp);
			}
			//TODO: length > 1 should mean conference not a string uri to avoid confusion. 
			else if(dest.length > 1){
				// this.createVvoipSession(call, dest, 'Anonymous', sdp);
				console.error('not support conference now');
				if(call){
					call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
				}
				return;
			}
			else
				console.error('address unsupported. ' + typeof(dest));
		};

		/**
		* @summary Answers REST vviop call and PUTs local SDP and "Connected" status
		*/
		this.acceptCallSession = function(call, sdp) {
			console.debug("RestAdapter.acceptCallSession()");
			if(call.uaCall.isOfferless) {
				this.answerOfferlessVvoipSession(call, sdp);
				call.uaCall.isOfferless = false;
			} else {
				this.answerVvoipSession(call, sdp);
			}
			this.updateVvoipSessionStatus(call, 'Connected');
			call.incomingCallSessionEvent({name: 'confirmed'});
		};

		/**
		* @summary Rejects REST vviop incoming call
		*/
		this.rejectCallSession = function(call, code, status) {
			console.debug("RestAdapter.rejectCallSession()");
			this.terminateVvoipSessoin(call);
		};

		/**
		* @summary Cacels outgoing REST vviop call before it is answered
		*/
		this.cancelCallSession = function(call) {
			console.debug("RestAdapter.cancelCallSession()");
			this.terminateVvoipSessoin(call);
		};

		/**
		* @summary Terminates REST vviop call by DELETing the call session
		*/
		this.terminateCallSession = function(call) {
			console.debug("RestAdapter.terminateCallSession()");
			this.terminateVvoipSessoin(call);
		};

		/**
		* @summary Cleans the resource for the call session
		*/
		this.cleanCallSession = function(call) {
			console.debug("RestAdapter.cleanCallSession()");
			//console.debug("cleanCallSession()");
		};

		/**
		* @summary Provides SIP-like way to handle vvoip call
		* REST won't really send responses but translates to REST PUT
		*/
		this.sendResponse = function(call, code, status, sdp) {
			console.debug("RestAdapter.sendResponse: " + code);
			if(code === 180){
				this.updateVvoipSessionStatus(call, 'Ringing');
			}
			else if(code === 200) {
				this.acceptCallSession(call, sdp);
			}
			else{
				this.terminateVvoipSessoin(call);
			}
		};

		/**
		* @summary POSTs registration reqeust
		* @private
		*/
		this.sendRegister = function() {
			//var regContent = new vvoip.vvoipRegistration(userId, token);
			var regContent = {'vvoipRegistration' : {
					'userId' : userId,
					'token' : token.id
			}};
			var regRequest = new RestUserAgent(this.ws);
			//regRequest.send('POST', '/vvoip/v1/' + userId + '/registrations', JSON.stringify(regContent));
			regRequest.send('POST', this.registerURL, JSON.stringify(regContent));
			this.request = regRequest;
		};

		/**
		* @summary Sends periodic GET to simulate long-polling
		* @private
		*/
		this.sendActiveQuery = function() {
			if(!this.regResourceURL || this.regResourceURL.length < 1) {
				console.error('Empty regResourceURL!')
				return;
			}
			var aqRequest = new RestUserAgent(this.ws);
			if(this.regResourceURL.indexOf('ws') > -1)
				this.regResourceURL = this.regResourceURL.replace(/ws.*:\/\//, '/');
			aqRequest.send('GET', this.regResourceURL + '/notifications');
		};

		/**
		* @summary Sends POST for calling the specified recipient
		* @param {string} addr of user identifier of the call recipient
		* @private
		*/
		this.createVvoipSession = function(call, addr, name, sdp) {
			var callJson = {'vvoipSession' : {
					'tParticipantAddress' : addr,
					'tParticipantName' : name,
					'offer' : {
						'sdp' : sdp
					}
			}};
			var callRequest = new RestUserAgent(this.ws);
			callRequest.send('POST', this.callURL, JSON.stringify(callJson));
			call.uaCall = callRequest;
			call.callId = 1;
		};

		/**
		* @summary PUTs sdp answer when answering an incoming vvoip call with sdp offer
		* @private
		*/
		this.answerVvoipSession = function(call, sdp) {
			var answerJson = {'vvoipAnswer' : {
				'sdp' : sdp
			}};
			if(!call.uaCall){
				var callRequest = new RestUserAgent(this.ws);
				call.uaCall = callRequest;
			}
			call.uaCall.send('PUT', call.uaCall.callResourceURL, JSON.stringify(answerJson));
		};

		/**
		* @summary PUTs sdp offer when answering an incoming vvoip call without sdp offer
		* @private
		*/
		this.answerOfferlessVvoipSession = function(call, sdp) {
			var offerJson = {'vvoipOffer' : {
				'sdp' : sdp
			}};
			if(!call.uaCall){
				var callRequest = new RestUserAgent(this.ws);
				call.uaCall = callRequest;
			}
			call.uaCall.send('PUT', call.uaCall.callResourceURL, JSON.stringify(offerJson));
		};

		/**
		* @summary PUTs vvoip call status to notify 'Ringing' or 'Connected' status
		* @param {string} status call status of 'Connected' or 'Ringing'
		* @private
		*/
		this.updateVvoipSessionStatus = function(call, status) {
			if(!call || !call.uaCall || !call.uaCall.callResourceURL){
				console.error('no call to update');
				if(call)
					call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
				return;
			}
			var statusJson = {'vvoipSessionStatus' : {
				'status' : status
			}};
			call.uaCall.send('PUT', call.uaCall.callResourceURL, JSON.stringify(statusJson));
		};

		/**
		* @summary DELETEs vvoip call when reject or terminate or cacel a call
		* @private
		*/
		this.terminateVvoipSessoin = function(call) {
			if(!call || !call.uaCall || !call.uaCall.callResourceURL){
				console.warn('no call to terminate');
				if(call)
					call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
				return;
			}
			call.uaCall.send('DELETE', call.uaCall.callResourceURL);
		};
		
		// received response or event notification from websocket
		this.received = function(data) {
			//console.debug('received: ' + data);
			var status = data.match(/HTTP\/1.1 (\d{3}) (.*)/);
			if(!status || status.length < 3){
				console.error('Unexpected response: ' + data);
				return;
			}
			console.debug('received response: ' + status[1] + ' ' + status[2]);
			var responseJson;
			var jsonStr = null;
			if(data.indexOf('\r\n\r\n') !== -1)
				jsonStr = data.substring(data.indexOf('\r\n\r\n')+2);
			if(jsonStr && jsonStr.trim().length > 2){
				responseJson = JSON.parse(jsonStr);
			}
			else{
				console.debug('Empty payload');
				responseJson = null;
			}
			// active query response/notification
			if(data.indexOf('Connection:') !== -1){
				//refresh active query immediately before callback
				this.sendActiveQuery(); 

				// if empty notification, no need to callback
				if(!responseJson){ 
					console.debug('Empty notification');
					return;
				}
				this.notifyCallback(responseJson);
			}
			else{
				// empty response
				if(!responseJson){
					// check delete call resource
					var call = this.session.getCall(1); //TODO: callId managing
					if(call) {
						call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
					}
					return;
				}
				// TODO: needs to call responseCallback here?
				if(responseJson.vvoipRegistration){
					this.regResourceURL = responseJson.vvoipRegistration.resourceURL;
					this.sendActiveQuery(); //TODO: needed for first time?
				}
				else if(responseJson.vvoipSession){
					var call = this.session.getCall(1); //TODO: callId managing
					if(call && call.uaCall) {
						call.uaCall.callResourceURL = responseJson.vvoipSession.resourceURL;
					}
				}
				else {
					console.log('response: ' + jsonStr);
				}
			}
		};

		/**
		* @summary Received event notification from active query resposne
		* @private
		*/
		this.notifyCallback = function (evt) {
			console.debug('received vvoip event notification: ' + evt);
			// register status
			if(evt.vvoipRegEventNotification){
				console.debug('received vvoipRegEventNotification');
				if(evt.vvoipRegEventNotification.eventType === 'RegSuccess'){
					this.setSessionStatus(SessionStatus.CONNECTED);
				}
				else {
					this.setSessionStatus(SessionStatus.DISCONNECTED);
				}
				return;
			}
			// incoming call invite
			else if(evt.vvoipSessionInvitationNotification){
				console.debug('received vvoipSessionInvitationNotification');
				var callRequest = new RestUserAgent(this.ws);
				callRequest.callResourceURL = evt.vvoipSessionInvitationNotification.link.href;
				var event;
				if (evt.vvoipSessionInvitationNotification.offer && evt.vvoipSessionInvitationNotification.offer.sdp) {
					event = {name: 'invitation', callId: 1, from: evt.vvoipSessionInvitationNotification.originatorAddress, sdp: evt.vvoipSessionInvitationNotification.offer.sdp, uaCall: callRequest};
				} else {
					callRequest.isOfferless = true;
					event = {name: 'invitation', callId: 1, from: evt.vvoipSessionInvitationNotification.originatorAddress, uaCall: callRequest};
				}
				this.session.incomingSessionEvent(event);
				//TODO: uaCall can be set to callRequest?
				var newCall = this.session.getCall(1); 
				if(newCall)
					newCall.uaCall = callRequest;
				else
					console.error('call is null');
				return;
			}

			// call session event: incoming bye, cancel requests or 180 ringing, 4xx reject resposne to outgoing calls
			var call = this.session.getCall(1); //TODO: callId managing
			if(!call || !call.uaCall) {
				console.warn('no active call to receive call notification');
				return;
			}
			if(evt.vvoipEventNotification){
				if(evt.vvoipEventNotification.eventType === 'SessionEnded'){
					console.debug('received SessionEnded');
					call.terminatedCallSessionEvent({name:CallStatus.DISCONNECTED});
				}
				else if(evt.vvoipEventNotification.eventType === "Cancelled"){
					console.debug('received Cancelled');
					call.terminatedCallSessionEvent({name:CallStatus.CANCELED});
				}
				else if(evt.vvoipEventNotification.eventType === "Declined"){
					console.debug('received Declined');
					call.rejectedCallSessionEvent({name:CallStatus.REJECTED});
				}
				else if(evt.vvoipEventNotification.eventType === "Ringing"){
					console.debug('received Ringing');
					call.ringingCallSessionEvent({name: CallStatus.CONNECTING});
				}
				else{
					console.warn('received unknown vvoipEventNotification!');				
				}
			}
			// 200 OK response to outgoing call
			else if(evt.vvoipAcceptanceNotification){
				console.debug('received vvoipAcceptanceNotification');
				var event = {name: CallStatus.CONNECTED,
					sdp: evt.vvoipAcceptanceNotification.answer.sdp};
				call.acceptedCallSessionEvent(event);
			}
			// media change re-invite from network
			else if(evt.vvoipOfferNotification){
				console.debug('received vvoipOfferNotification');
				var event = {name: 'invitation', sdp: evt.vvoipOfferNotification.offer.sdp};
				call.incomingCallSessionEvent(event);
			}
			// sdp answer to bodiless invite
			else if(evt.vvoipAnswerNotification){
				console.debug('received vvoipAnswerNotification');
				var event = {name: 'confirmed', sdp: evt.vvoipAnswerNotification.answer.sdp};
				call.incomingCallSessionEvent(event);
			}
			else{
				console.debug('received unknown notification!');
			}
		};
	};

	/**
	* @summary Contructs REST request and send it over websocket
	* @private
	*/
	function RestUserAgent(websocket) {

		// Set some default headers
		var defaultHeaders = {
			"Accept": "application/json",
			"Content-Type": "application/json",
		};
		
		var headers = defaultHeaders;
		//var timestamp = new Date().getTime();

		this.callResourceURL = null;

		/**
		 * Public vars
		 */
		this.ws = websocket;

		// Request
		this.request = null;
		this.method = '';

		// Result & response
		this.response = null;
		this.responseJson = null;
		this.status = null;
		this.statusText = '';
		
		this.isOfferless = false;

		this.setRequestHeader = function(header, value) {
			headers[header] = value;
		};

		this.send = function(method, resourceUrl, data) {
			if(method === 'GET' || method === 'DELETE')
				data = null;
			this.method = method;
			headerStr = '';
			for(var h in headers){
				headerStr += h + ': ' + headers[h] + '\r\n';
			}
			text = method + ' ' + resourceUrl + ' HTTP/1.1\r\n';
			text += headerStr;
			if(data !== null){
				text += '\r\n';
				text += data;
			}
			console.debug('ws send:\r\n' + text);
			this.ws.send(text);
		}
	};
	orcaALU.RestAdapter = RestAdapter;
}());
