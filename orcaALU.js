/**
 *  Copyright (c) 2013 Alcatel-Lucent
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *  http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/* $Id: orcaALU.js 421 2014-12-26 06:47:03Z wenwenzh $ */
/*jslint devel: true */

console.trace = function (data) {
	if(navigator.userAgent.match(/Chrome/i))
		console.debug("[" + new Date().toUTCString() + "] " + data + (new Error).stack.replace(/Error|http.*\//g,''));
	else
		console.debug(data);
};

(function () {
	/*global SessionStatus, SessionError, CallStatus, CallError, WebSocket, Call, sip, localStorage, orca, setTimeout,
	 webkitRTCPeerConnection, RTCSessionDescription, SessionDescription, window, DOMParser,
	 XMLSerializer, ActiveXObject, document, ResourceList, Multipart*/

	/**
	* XML namespaces
	* @private
	*/
	var NS = {
		ab: 'urn:oma:xml:rest:netapi:addressbook:1'
	};
	
	var isFirstSession = true;

	 // adapting for Firefox
	console.debug('ORCA/$Rev: 421 $; ' + navigator.userAgent);
	if(typeof orcaVersion !== 'undefined')
		console.debug('ecms: ' + orcaVersion);

	if (navigator.mozGetUserMedia) {
		console.debug('Firefox adapting');
		// The RTCPeerConnection object.
		webkitRTCPeerConnection = mozRTCPeerConnection;

		// The RTCSessionDescription object.
		RTCSessionDescription = mozRTCSessionDescription;

		// The RTCIceCandidate object.
		RTCIceCandidate = mozRTCIceCandidate;

		// Get UserMedia (only difference is the prefix).
		// Code from Adam Barth.
		navigator.getUserMedia = navigator.mozGetUserMedia;

		// Attach a media stream to an element.
		attachMediaStream = function(element, stream) {
			console.log("Attaching media stream");
			element.mozSrcObject = stream;
			element.play();
		};

		reattachMediaStream = function(to, from) {
			console.log("Reattaching media stream");
			to.mozSrcObject = from.mozSrcObject;
			to.play();
		};

	} else if (navigator.webkitGetUserMedia) {
		console.debug('chrome adapting');
		navigator.getUserMedia = navigator.webkitGetUserMedia;
	} else {
		console.warn("Browser does not appear to be WebRTC-capable");
	}

	// ManagedStream is implemented in orca.js

	/**
	*
	* @classdesc Session objects are obtained by calling the createSession method of the global {@Link orca} object
	* @summary Manages communications for a given user identity
	* @constructor
	* @param {Userid} userid The user's unique identifier
	* @param {Token} token An authorization token associated with the provided userid
	* @param {SessionConfig} sessionConfig session initialization parameters
	* @memberOf orca
	*/
	function Session(userId, token, config, callback) {
		this.callback = callback;

	   /**
		*
		* @summary Possible states of a WebSocket connection
		* @typedef WebSocketStatus
		* @type enum
		* @property {string} CONNECTED The WebSocket connection is established
		* @property {string} CONNECTING The WebSocket connection is in the process of being established
		* @property {string} DISCONNECTED The WebSocket connection has been torn down
		*/
		this.WebSocketStatus = {};
		this.WebSocketStatus.DISCONNECTED = '0';
		this.WebSocketStatus.CONNECTING = '1';
		this.WebSocketStatus.CONNECTED = '2';

	   /**
		*
		* @summary Possible states of a WebSocket connection
		* @typedef RegisterStatus
		* @type enum
		* @property {string} UNREGISTERED The web user is not registered on IMS core.
		* @property {string} WAITING The web user registration is in a waiting state.
		* @property {string} REGISTERED The web user is registered on IMS core.
		*/
		this.RegisterStatus = {};
		this.RegisterStatus.UNREGISTERED = '0';
		this.RegisterStatus.WAITING = '1';
		this.RegisterStatus.REGISTERING = '2';
		this.RegisterStatus.REGISTERED = '3';

		/**
		 * The user's unique identifier.
		 * @type string
		 * @private
		 */
		this.userId = userId;

		/**
		 * An authorization token associated with the provided userid.
		 * @type {object}
		 * @private
		 */
		this.token = token;

		/**
		 * Session initialization parameters.
		 * @type {SessionConfig}
		 * @private
		 */
		this.config = config;

		/**
		 * Session status.
		 * @type {SessionStatus}
		 * @private
		 */
		this.sessionStatus = SessionStatus.DISCONNECTED;

		/**
		 * WebSocket connection status.
		 * @type {SocketStatus}
		 * @private
		 */
		this.socketStatus = this.WebSocketStatus.DISCONNECTED;


		/**
		 * WebSocket connection.
		 * @type {WebSocket}
		 * @private
		 */
		this.ws = undefined;

		/**
		 * Local Address Of Record (AOR).
		 * @type string
		 * @private
		 */
		this.localAOR = userId;

		/**
		 * List of calls.
		 * @type Call[]
		 * @private
		 */
		this.calls = [];

		/**
		 * List of presence subscription.
		 * @type PresenceSubscription[]
		 * @private
		 */
		this.presenceSubscriptions = [];

		this.adapter = null;

		var self = this;

		/* Service continuity flags */
		this.recoveryAttemptsRemaining = config.providerConfig.maxRecoveryAttempts;
		this.wsRestoreInProgress = false;
		this.ws_only = false;
		this.autoAnswerMode = false;
		this.needAuthOnReRegister = false;
		this.closePending = false;
		this.autoAnswerTimer = false;
		//for keep-alive
		this.isReceivePong = false;

		/**
		* @summary Update token.key and refresh session
		*/
		this.updateToken = function (tokenKey) {
			console.debug("orcaALU.updateToken");
			this.token = token;
			this.adapter.updateToken(tokenKey);
			this.adapter.createSession();
		};

		/**
		* @summary send ping frame
		*/		
		this.sendPingFrame = function () {
				var crlfKeepAliveInterval = isNaN(config.providerConfig.crlfKeepAliveInterval) ? 0 : parseInt(config.providerConfig.crlfKeepAliveInterval);
				console.log("crlfKeepAliveInterval is " + crlfKeepAliveInterval);
				
				if(crlfKeepAliveInterval > 0){
				    var timeOut;
				    if(crlfKeepAliveInterval > 10){
				        timeOut = 10;
				    }else{
				        timeOut = crlfKeepAliveInterval;
				    }
				    this.SendPingMessage(timeOut);
					this.sendPingMessageInterval = setInterval(function () {self.SendPingMessage(timeOut);}, crlfKeepAliveInterval * 1000);
				
				}
		};

		/**
		* @summary Internal function called to send ping message to the server
		* @private
		*/
		this.SendPingMessage = function (timeOut) {
			console.debug('Send CRLF Keep Alive request, timeOut:' + timeOut);
			this.isReceivePong = false;
			this.sendPingMessageTimer = setTimeout(function () {self.sendPingMessageTimeout();}, timeOut * 1000);
			this.ws.send('\r\n\r\n');
		};

		/**
		* @summary Internal function called to handle send ping message timeout
		* @private
		*/
		this.sendPingMessageTimeout = function () {
			console.debug('Enter sendPingMessageTimeout, isReceivePong:' + this.isReceivePong);
			if(!this.isReceivePong){
				console.debug ("Can't receive the pong meesage, disconnect the session and close the WebSocket" );
				this.setSessionStatus(SessionStatus.DISCONNECTED, SessionError.NETWORK_ERROR);
				this.ws.close(1000, 'CRLF heartbeat failure');
			}
		}

		/* MDSP (Multiple Devices Sharing PUID) */
		this.mdsp = {	// Define mdsp object properties and methods
			myOwnGruu: '',

			gruuSupported: false,   // true is Register's 200 OK comes back with pub-gruu

			isGRUUsupported:  function() { return this.gruuSupported;},

			setGRUUsupport:  function( boolVal) { this.gruuSupported = boolVal;},

			contacts:  [],		// Info about other associated contacts
						// each contact array element holds:
						//	gruu, sipUri, displayName, isSecondaryDevice, dialog[]
						// each dialog array element holds:
						// 	dialogId, callId, remoteId, state, exclusive, localTag, remoteTag, direction and mediaAttr[]
						// each mediaAttr element holds:
						//	mediaType, mediaDirection

        		onContactsUpdate: function() {   // callback to notify user of updates.
            			if (typeof callback.onMDSPinfoUpdate === 'function') {
					callback.onMDSPinfoUpdate();
				}
			},

			isFeatureEnabled:  function() { return self.config.providerConfig.enableMDSPsupport;},

			getSecDeviceId:  function() { return self.config.providerConfig.secondaryDeviceId;},

			getContacts:  function() { return this.contacts;},

                        addContact:  function( gruu, sipUri, displayName, isSecondaryDevice) {
                                var i;
                                /*
                                 *  If the contact to be added is the current device itself
                                 *  then don't add it to the contact array.
                                 */
                                if ( gruu == this.myOwnGruu ) {
                                        return false;
                                }

                                /* Check if the contact to be added is already in the array. */
                                for ( i = 0 ; i < this.contacts.length ; ++i )
                                {
                                        if ( this.contacts[i].gruu == gruu )
                                        {
                                                /* Contact is already in array */
                                                return false;
                                        }
                                }

                                this.contacts.push( {gruu:        gruu,
                                                     sipUri:      sipUri,
                                                     displayName: displayName,
                                                     isSecondaryDevice: isSecondaryDevice,
                                                     dialog:      []  } );

                                return true;
                        },

			addDialog:  function( ndElem /* Notify Dialog Element */ ) {
                                var i;
                                for ( i = 0 ; i < this.contacts.length ; ++i )
                                {
					if ( this.contacts[i].displayName == ndElem.localDisplayName )
					{
						this.contacts[i].dialog.push( { dialogId: ndElem.dialogId,
										callId:   ndElem.callId,
										remoteId: ndElem.remoteId,
										state:	  ndElem.state,
										exclusive: ndElem.exclusive,
										direction: ndElem.direction,
										localTag: ndElem.localTag,
										remoteTag: ndElem.remoteTag,
										mediaAttr: ndElem.mediaAttr
									      } );
						return true;
					}
                                }
				console.log("Unable to add dialog, displayName not found:\n" +
						"\tdisplayName = " + ndElem.localDisplayName + "\n" +
						"\tdialogId = " + ndElem.dialogId + "\n" +
						"\tcallId   = " + ndElem.callId + "\n" +
						"\tremoteId = " + ndElem.remoteId + "\n" +
						"\tstate    = " + ndElem.state + "\n" +
						"\texclusive= " + ndElem.exclusive + "\n" +
						"\tdirection= " + ndElem.direction + "\n" +
						"\tlocalTag = " + ndElem.localTag + "\n" +
						"\tremoteTag= " + ndElem.remoteTag );
				for ( i = 0 ; i < ndElem.mediaAttr.length ; ++i )
				{
					console.log(
						"\tmediaAttr["+i+"].mediaType      = " + ndElem.mediaAttr[i].mediaType + "\n" +
						"\tmediaAttr["+i+"].mediaDirection = " + ndElem.mediaAttr[i].mediaDirection);
				}

				return false;
                        },

			logContacts:  function( noteStr, dumpMyOwnGruu) {
                                var i, j, k;
				console.log("MDSP Contacts: " + ((noteStr)?noteStr:'') + ":\n");
                                for ( i = 0 ; i < this.contacts.length ; ++i )
                                {
                                        console.log("contacts["+i+"].displayName = " + this.contacts[i].displayName);
                                        console.log("contacts["+i+"].gruu   = " + this.contacts[i].gruu);
                                        console.log("contacts["+i+"].sipUri = " + this.contacts[i].sipUri);
                                        console.log("contacts["+i+"].isSecondaryDevice = " + this.contacts[i].isSecondaryDevice);
					console.log("\tDialogs:\n");
					for ( j = 0 ; j < this.contacts[i].dialog.length ; ++j )
					{
						console.log( "\t\tdialog["+j+"].dialogId = " + this.contacts[i].dialog[j].dialogId +
							"\n\t\tdialog["+j+"].callId   = " + this.contacts[i].dialog[j].callId +
							"\n\t\tdialog["+j+"].state    = " + this.contacts[i].dialog[j].state +
							"\n\t\tdialog["+j+"].remoteId = " + this.contacts[i].dialog[j].remoteId +
							"\n\t\tdialog["+j+"].exclusive= " + this.contacts[i].dialog[j].exclusive +
							"\n\t\tdialog["+j+"].direction= " + this.contacts[i].dialog[j].direction +
							"\n\t\tdialog["+j+"].localTag = " + this.contacts[i].dialog[j].localTag +
							"\n\t\tdialog["+j+"].remoteTag= " + this.contacts[i].dialog[j].remoteTag );
						for ( k = 0 ; k < this.contacts[i].dialog[j].mediaAttr.length ; ++k )
						{
							console.log( "\t\t\tmediaAttr["+k+"].mediaType = " + this.contacts[i].dialog[j].mediaAttr[k].mediaType + "\n" +
								"\t\t\tmediaAttr["+k+"].mediaDirection = " + this.contacts[i].dialog[j].mediaAttr[k].mediaDirection);
						}
					}
					if ( this.contacts[i].dialog.length == 0 )
					{
						console.log("\t\tNone\n");
					}
                                }

				if ( i == 0 )
				{
					console.log("None\n");
					return;	
				}
								
                                if ( dumpMyOwnGruu )
                                {
                                        console.log("My own GRUU = " + this.myOwnGruu);
                                }
                        },

			subscribeDialog:  function( sipUri) {
 				self.adapter.sendSubscribeDialog( sipUri);
			},

			dialogSubscriptions: [],	// array of dialogSubscriptions
							// each element holds sipUri, expTimerId

			subscribeToMDSPContactDialogs: function() {
				var i;
				for ( i = 0 ; i < this.contacts.length ; i++ )
				{
					if ( this.getDialogSubscriptionIndex( this.contacts[i].sipUri) == (-1) )
					{
						/*
						 *  We don't have a dialog subscription in effect for
						 *  this sipUri so send a subscribe.
						 */
						this.subscribeDialog( this.contacts[i].sipUri);
						this.addDialogSubscription( this.contacts[i].sipUri);
					}
				}
			},

			subscribeDialogTimerExp:  function( sipUri) {
				var i;
				var dialogSubsIndex = this.getDialogSubscriptionIndex( sipUri);
		
				/*
				 *  If we still have a contact having this sipUri 
				 *  send the dialog subscribe and restart the expiration timer.
				 *  Otherwise, remove the subscription and don't restart the timer.
				 */
				for ( i = 0 ; i < this.contacts.length; ++i )
				{
					if ( this.contacts[i].sipUri == sipUri )
					{
						this.subscribeDialog( sipUri);
						if ( dialogSubsIndex >= 0 )
						{
							var expTimerId = setTimeout( this.subscribeDialogTimerExp.bind(this), 60*60*1000, sipUri);
							this.dialogSubscriptions[dialogSubsIndex].expTimerId = expTimerId;
						}
						else
						{
							this.addDialogSubscription( sipUri);
						}
						return;
					}
				}

				/*
				 *  If we exit the for-loop above then we no longer have any
				 *  contact with a sipUri for the dialog subscription which just expired.
				 *  So there is no need to re-subscribe and we can remove the 
				 *  dialogSubscription entry if it exits.
				 */
				if ( dialogSubsIndex >= 0 )
				{
					/* Remove array element at dialogSubsIndex */
					dialogSubscriptions.splice( dialogSubsIndex, 1);
				}		
			},

			addDialogSubscription: function( sipUri) {
				var expTimerId = setTimeout( this.subscribeDialogTimerExp.bind(this), 60*60*1000, sipUri);
				this.dialogSubscriptions.push( { sipUri:     sipUri,
								 expTimerId: expTimerId } );
			},

			getDialogSubscriptionIndex: function( sipUri) {
				var i;
				for ( i = 0 ; i < this.dialogSubscriptions.length ; i++ )
				{
					if ( this.dialogSubscriptions[i].sipUri == sipUri )
					{
						return i;
					}
				}
				return -1;
			},

			clearDialogSubscriptions: function() {
				var i;
				for ( i = 0 ; i < this.dialogSubscriptions.length ; i++ )
				{
					clearTimeout( this.dialogSubscriptions[i].expTimerId );
				}
			},

			clearMDSPcontacts: function() {
				this.contacts = [];
				this.clearDialogSubscriptions();
				this.onContactsUpdate();
			},

        		onDialogNotify: function( requestBody) {
				var parser;
				var xmlDoc;
				var mimeType = "application/xml";
				//mimeType = "text/xml";
				var newDialogInfo = [];		
				var newDialogInfoElem;
				var i;
				var dialogArray;
	
				console.debug( "mdsp.onDialogNotify():");

				/*
				 *  We will parse the Notify body and extract the dialog information
				 *  saving the following for each dialog:
				 *  newDialogInfo[] = { localDisplayName, // eg. 'Tu41 Tablet'
				 *			dialogId,	// eg. d123456-123
				 *			callId,		// eg. '3353359662@r7819133724.invalid'
				 *			remoteId,	// eg. sip:+17315400048@cpr01.lucentlab.com
				 *			state,		// eg. 'confirmed'
				 *			exclusive,	// if true, call cannot be 'Pulled'
				 *			direction,	// eg. "initiator" or "recipient"
				 *			localTag,	// local-tag attribute from dialog
				 *			remoteTag,	// remote-tag attribute from dialog
				 *			mediaAttr[]     // array elements hold: mediaType, mediaDirection
				 *		      }
				 *  The localDisplayName can later be used to find the contact or specific
				 *  PUID shared device with which the dialog is associated.
				 */

				if (window.DOMParser)
				{
					parser=new DOMParser();
					xmlDoc=parser.parseFromString( requestBody, mimeType);
				}
				else // Internet Explorer
				{
					xmlDoc=new ActiveXObject("Microsoft.XMLDOM");
					xmlDoc.async=false;
					xmlDoc.loadXML( requestBody); 
				}

				dialogArray = xmlDoc.getElementsByTagName("dialog");
				console.log("dialogArray.length = " + dialogArray.length);
	
				for ( i = 0 ; i < dialogArray.length ; ++i )
				{
					newDialogInfoElem = this.getDialogInfoElemFromNotifyDialog( dialogArray[i]);
					newDialogInfo.push( newDialogInfoElem);
				}
	
				this.reconcileMDSPDialogs( newDialogInfo);
			},

			getDialogInfoElemFromNotifyDialog: function( dpnd /* domParsedNotifyDialog */) {
				var i, j, k;

				console.log("getDialogInfoElemFromNotifyDialog()");

				/*
				 *  We will save the following from the dom parsed dialog received:
				 *  newDialogElem = { localDisplayName, // eg. 'Tu41 Tablet'
				 *			dialogId,	// eg. d123456-123
				 *			callId,		// eg. '3353359662@r7819133724.invalid'
				 *			remoteId,	// eg. sip:+17315400048@cpr01.lucentlab.com
				 *			state,		// eg. 'confirmed'
				 *			exclusive,	// if true, call cannot be 'Pulled'
				 *			direction,	// eg. "initiator" or "recipient"
				 *			localTag,	// local-tag attribute from dialog
				 *			remoteTag,	// remote-tag attribute from dialog
				 *			mediaAttr[]     // array elements hold: mediaType, mediaDirection
				 *		    }
				 *  The localDisplayName can later be used to find the contact or specific
				 *  PUID shared device with which the dialog is associated.
				 */
				var newDialogElem = { localDisplayName: 'Unavailable',
							dialogId: '0000',
							callId:	'',
							remoteId: '',
							state: '',
							exclusive: false,
							direction: '',
							localTag: '',
							remoteTag: '',
							mediaAttr: [],
						    };

				/*  Get dialogId, callId, localTag and remoteTag from attributes */
				if (   ( dpnd.attributes != undefined )
				    && ( dpnd.attributes.length > 0 ) )
				{
					for ( i = 0 ; i < dpnd.attributes.length ; ++i )
					{
						if ( dpnd.attributes[i].localName == "id" )
						{
							newDialogElem.dialogId = dpnd.attributes[i].textContent;
						}
						else if ( dpnd.attributes[i].localName == "call-id" )
						{
							newDialogElem.callId = dpnd.attributes[i].textContent;
						}
						else if ( dpnd.attributes[i].localName == "local-tag" )
						{
							newDialogElem.localTag = dpnd.attributes[i].textContent;
						}
						else if ( dpnd.attributes[i].localName == "remote-tag" )
						{
							newDialogElem.remoteTag = dpnd.attributes[i].textContent;
						}
						else if ( dpnd.attributes[i].localName == "direction" )
						{
							newDialogElem.direction = dpnd.attributes[i].textContent;
						}
					}
				}

				/*  Get localDisplayName, remoteId, state and exclusive from childNodes. */
	 
				for ( i = 0 ; i < dpnd.childNodes.length ; ++i )
				{
					if ( dpnd.childNodes[i].localName == "exclusive" )
					{
						newDialogElem.exclusive = ((dpnd.childNodes[i].textContent == "true") ? true : false);
					}
					else if ( dpnd.childNodes[i].localName == "state" )
					{
						newDialogElem.state = dpnd.childNodes[i].textContent; // eg. "confirmed"
					}
					else if ( dpnd.childNodes[i].localName == "remote" )
					{
						for ( j = 0 ; j < dpnd.childNodes[i].childNodes.length ; ++j )
						{
							if ( dpnd.childNodes[i].childNodes[j].localName == "identity" )
							{
								newDialogElem.remoteId = dpnd.childNodes[i].childNodes[j].textContent; // eg. "sip:+17315400048@cpr01.lucentlab.com"
							} 
							else if ( dpnd.childNodes[i].childNodes[j].localName == "mediaAttributes" )
							{
								var mediaAttrElem = {};
								for ( k = 0 ; k < dpnd.childNodes[i].childNodes[j].childNodes.length ; ++k )
								{
									if ( dpnd.childNodes[i].childNodes[j].childNodes[k].localName == "mediaType" )
									{
										mediaAttrElem.mediaType = dpnd.childNodes[i].childNodes[j].childNodes[k].textContent; // eg. "audio" or "video"
									} else if ( dpnd.childNodes[i].childNodes[j].childNodes[k].localName == "mediaDirection" )
									{
										mediaAttrElem.mediaDirection = dpnd.childNodes[i].childNodes[j].childNodes[k].textContent; //eg. "sendrecv", "inactive", etc.
									}
								}
								newDialogElem.mediaAttr.push( mediaAttrElem);
							}
						}
					}
					else if ( dpnd.childNodes[i].localName == "local" )
					{
						for ( j = 0 ; j < dpnd.childNodes[i].childNodes.length ; ++j )
						{
							/* 
							 *  The local identity is not saved because it's just going to be our own PUID.
							 *  so just get the display-name which should uniquely distinguish the device.
							 */

							if ( dpnd.childNodes[i].childNodes[j].localName == "identity" )
							{
								/*  The local display-name should uniquely distinguish the device. */
								for ( k = 0 ; k < dpnd.childNodes[i].childNodes[j].attributes.length ; ++k )
								{
									if ( dpnd.childNodes[i].childNodes[j].attributes[k].localName == "display-name" )
									{
										newDialogElem.localDisplayName = dpnd.childNodes[i].childNodes[j].attributes[k].textContent;
									}
								}
							}
						}
					}
				}

				return newDialogElem;
			},

			reconcileMDSPDialogs:  function( newDialogInfo) {
				var i, j;
				console.log("reconcileMDSPDialogs(), newDialogInfo.length = " + newDialogInfo.length);

				/*
				 *  Remove any pre-existing MDSP dialog information and
				 *  add in the new Notify Dialog information received (passed to this function).
				 */
                                for ( i = 0 ; i < this.contacts.length ; ++i )
                                {
					this.contacts[i].dialog.splice( 0, this.contacts[i].dialog.length);
                                }

				for ( i = 0 ; i < newDialogInfo.length ; ++i )
				{
					this.addDialog( newDialogInfo[i]);
				}
	
				for ( i = 0 ; i < newDialogInfo.length ; ++i )
				{
					console.log("newDialogInfo["+i+"].localDisplayName = " + newDialogInfo[i].localDisplayName);
					console.log("newDialogInfo["+i+"].dialogId         = " + newDialogInfo[i].dialogId);
					console.log("newDialogInfo["+i+"].callId           = " + newDialogInfo[i].callId);
					console.log("newDialogInfo["+i+"].remoteId         = " + newDialogInfo[i].remoteId);
					console.log("newDialogInfo["+i+"].state            = " + newDialogInfo[i].state);
					console.log("newDialogInfo["+i+"].exclusive        = " + newDialogInfo[i].exclusive);
					console.log("newDialogInfo["+i+"].direction        = " + newDialogInfo[i].direction);
					console.log("newDialogInfo["+i+"].localTag         = " + newDialogInfo[i].localTag);
					console.log("newDialogInfo["+i+"].remoteTag        = " + newDialogInfo[i].remoteTag);
					for ( j = 0 ; j < newDialogInfo[i].mediaAttr.length ; ++j )
					{
						console.log("newDialogInfo["+i+"].mediaAttr["+j+"].mediaType = " + newDialogInfo[i].mediaAttr[j].mediaType);
						console.log("newDialogInfo["+i+"].mediaAttr["+j+"].mediaDirection = " + newDialogInfo[i].mediaAttr[j].mediaDirection);
					}
				}
				this.onContactsUpdate();
			},

			getContactFromGruu: function( gruu) {
				var i;

				for ( i = 0 ; i < this.contacts.length ; ++i ) {
					if ( this.contacts[i].gruu == gruu ) {
						return this.contacts[i];
					}
				}
				return null;
			},

			pushCallToContact: function( call, pushToGruu) {
				var contact;

				contact = this.getContactFromGruu( pushToGruu);
				if ( contact == null )
				{
					console.error("Unable to locate MDSP contact for GRUU = " + gruu);
					return;
				}
				self.adapter.doPush( call, contact.sipUri, pushToGruu);
			},

			pullCallFromMDSPdialog: function( call, callInfo) {
				call.getCallImp().pullCallInfo = callInfo;
			},

			getReplacesUriForPull: function( callInfo) {
				return ( callInfo.dialogElem.callId +
					';to-tag=' + callInfo.dialogElem.localTag +
					';from-tag=' + callInfo.dialogElem.remoteTag );
			},

			getToUriForPull: function( callInfo) {
				var i;
				var toUri;
				var pullFromDev = 'VoLTE-';
				var pullFromDevSuffix = 'active';
				var realm = self.userId.slice( userId.indexOf('@') + 1);   // eg. realm=cpr01.lucentlab.com;
				var contact = this.getContactFromGruu( callInfo.gruu);
				
				if ( contact == null ) {
					console.debug( "Unable to find MDSP contact for GRUU = " + callInfo.gruu);
				} else if ( contact.isSecondaryDevice ) {
					pullFromDev = 'SP-';
				}

				for ( i = 0 ; i < callInfo.dialogElem.mediaAttr.length ; ++i )
				{
					if (   (   ( callInfo.dialogElem.mediaAttr[i].mediaType == "audio" )
						|| ( callInfo.dialogElem.mediaAttr[i].mediaType == "video" ) )
					    && ( callInfo.dialogElem.mediaAttr[i].mediaDirection != "sendrecv" ) )
					{
						pullFromDevSuffix = 'hold';
					}
				}

				toUri = "sip:" + "pull-" + pullFromDev + pullFromDevSuffix + '@' + realm;
						
				return toUri;
			},

			getRequestUriUserForPull: function() {
				return "pull-VoLTE-active";
			}

		}; /* end mdsp */

		/**
		* @summary Update token and refresh session
		*/
		this.updateToken = function (token) {
			console.debug("orcaALU.updateToken");
			this.token = token;
			this.adapter.updateToken(token);
			this.adapter.createSession();
		};


 		/**
                * @ Print configuration data
                */
                this.printConfig = function ()
                {

                        console.debug ("Config Parameters Start:\n" );

			console.debug("userId: " + this.userId);
                        console.debug("token.id: " + this.token.id);
                        console.debug("token.key: " + this.token.key);
			console.debug("token.displayName: " + this.token.displayName);
                        console.debug("token.authtype: " + this.token.authtype);
                        console.debug("uri: " + this.config.uri);
                        console.debug("mediatypes: " + this.config.mediatypes);

                        var jsonConfig = JSON.stringify(this.config.providerConfig);
                        var configOptions = jsonConfig.split(",");
                        for ( i in configOptions )
                        {
                                console.debug ( configOptions[i] );
                        }

                        console.debug ("Config Parameters End:\n" );
                }




		/**
		* Activates the communications session with a gateway server
		* @method
		*/
		this.connect = function () {
			console.debug("[" + new Date().toUTCString() + "] " + "Session.connect()");
			this.printConfig();
			
			if(!this.config.providerConfig.addCodecs && this.config.providerConfig.addCodecs !== false){
				this.config.providerConfig.addCodecs = true;
				console.debug("use default value 'Enabled' for the addCodecs");
			}
			if (isFirstSession) {
				isFirstSession = false;
				if (this.config.providerConfig.autoAnswerTime > 0) {
					this.autoAnswerTimer = setTimeout(function () {
						self.autoAnswerTimer = false;
					}, this.config.providerConfig.autoAnswerTime * 1000);
				}
			}
			
			if (this.socketStatus === this.WebSocketStatus.DISCONNECTED) {
				this.createWebSocket();
			} else {
				console.error("your session is already connecting or connected to the gateway");
			}
		};

		this.createWebSocket = function () {
			console.debug("[" + new Date().toUTCString() + "] " + "Session.createWebSocket()");
			var uri = this.config.uri;
			if ((uri.substr(0, 2) !== "ws") && (uri.substr(0, 3) !== "wss")) {
				console.error("URI of the gateway is malformed.");
				return;
			}

			console.debug("connect to " + uri + ' interfaceType: ' + this.config.providerConfig.interfaceType);
			if(this.config.providerConfig.interfaceType === 'REST-WS') {
				this.ws = new WebSocket(uri, ["ALURest"]);
				this.adapter = new orcaALU.RestAdapter(this.ws, userId, token, config, this);				
			}
			else{
				this.ws = new WebSocket(uri, ["sip"]);
				this.adapter = new orcaALU.SipAdapter(this.ws, userId, token, config, this);
			}
			this.ws.binaryType = 'arraybuffer';
			this.socketStatus = this.WebSocketStatus.CONNECTING;

			this.ws.onopen = function (evt) {
				self.onWebSocketOpen(evt);
			};
			this.ws.onclose = function (evt) {
				self.onWebSocketClose(evt);
			};
			this.ws.onerror = function (evt) {
				self.onWebSocketError(evt);
			};
			this.ws.onmessage = function (evt) {
				self.onWebSocketMessage(evt);
			};
		};

		/**
		* Creates a new call instance for communication with the specified recipient
		* @param {string[]} to list of user identifier of the call recipients
		* @param {string} mediatypes Comma separated list of media stream types to be used during the call Eg. "audio,video"
		* @returns {orca.Call}
		*/
		this.createCall = function (to, mediatypes, session, callback) {
			console.debug("Session.createCall()");
			var call = new Call(to, mediatypes, session, callback);
			this.calls.push(call);
			return call;
		};

        /**
        * Creates a new chat instance for communication with the specified recipient
        * @param {string} to The user identifier of the chat invitee. In Orca ALU, this is the
        * user's public ID.
        */
        this.createChat = function (to, session, callback) {
            return new Chat(to, session, callback);
        };

        /**
         * Creates a new page mode chat instance for communication with the specified recipient
         * @param {string} to The user identifier of the chat invitee. In Orca ALU, this is the
         * user's public ID.
         */
         this.sendPageModeChatMessage = function (to, message) {
        	 var pageModeChat = new PageModeChat(to, this, message);
        	 this.calls.push(pageModeChat);
        	 pageModeChat.sendMessage();
         };
         
         /**
         * Creates a new sms message instance for communication with the specified recipient
         * @param {string} to The user identifier of the chat invitee. In Orca ALU, this is the user's public ID.
         * @param {string} message The message content user sent
         * @param {Object} smsIMDNMessageInfo Message attributes
         */
         this.sendSmsMessage = function (to, message, smsIMDNMessageInfo) {
         	var imdnMessageID = generateImdnMessageID(9);
         	var dateTime = ISODateString(new Date());
         	console.info("generate imdnMessageID:" + imdnMessageID);
         	console.info("ISO dateTime:" + dateTime);
         	
			var smsMessage = new SmsMessage(to, this, imdnMessageID, dateTime, message);
			this.calls.push(smsMessage);
			smsMessage.sendMessage();
			smsIMDNMessageInfo.setSmsIMDNMessageID(imdnMessageID);
			smsIMDNMessageInfo.setDateTime(dateTime);
         };
         
         /**
         * Creates a new IMDN message instance for communication with the specified recipient
         * @param {string} to The user identifier of the chat invitee. In Orca ALU, this is the
         * @param {string} imdnMessageID The message ID
         * @param {string} status The message sent status
         * @param {string} dateTime The message sent time
         * user's public ID.
         */
         this.sendSmsIMDNMessage = function (to, imdnMessageID, status, dateTime) {
			var smsIMDNMessage = new SmsIMDNMessage(to, this, imdnMessageID, status, dateTime);
			this.calls.push(smsIMDNMessage);
			smsIMDNMessage.sendMessage();
         };


        /**
        * Creates a new file transfer communication to send a file to the specified recipient
        * @param {string} to The user identifier of the file recipient. In Orca ALU, this is the
        * user's public ID.
        * @param {File|Blob} file The file to send
        */
        this.createFileTransfer = function (to, file, session, callback) {
            return new FileTransfer(to, file, session, callback);
        };

        /**
        * Creates a new image share communication to send an image file to the specified recipient
        * @param {string} to The user identifier of the image recipient. In Orca ALU, this is the
        * user's public ID.
        * @param {File|Blob} file The image file to send
        */
        this.createImageShare = function (to, file, session, callback) {
            return new ImageShare(to, file, session, callback);
        };

        /**
         * Subscribe to current and future presence updates of a presentity 
         * or presentities in a presence list.
         * 
         * @param {string} presenceResource A presentity or a presence list
         */
         this.subscribePresence = function (presenceResource) {
 			this.adapter.sendSubscribePresence(presenceResource);
         };

         this.test = function(testString) {
         	var evt = {data: testString};
         	this.onWebSocketMessage(evt);
         } 
         /**
         * Request current presence information of a presentity or 
         * presentites of a presence list. getPresence() will also
         * terminate the former subscription made on the same presence
         * resource by the watcher
         * 
         * @param {string} presenceResource A presentity or a presence list
         */
         this.getPresence = function (presenceResource) {
 			this.adapter.sendSubscribePresence(presenceResource, 0);
         };
         
         /**
          * Update own presence information for others to see.
          * @param {string} presenceInfo pidf XML or pidf-diff XML
          * that are defined by RFC 3386, 5263, 5196, 4480
          */
        this.updatePresence = function (presenceInfo) {
        	 this.adapter.sendUpdatePresence(presenceInfo);
        };

		/**
		* Ends and active communications session with a gateway server
		*
		*/
		this.disconnect = function () {
			console.debug("Session.disconnect()");
			if (this.socketStatus !== this.WebSocketStatus.DISCONNECTED) {
				this.adapter.terminateSession();
			} else {
				console.warn("Session.disconnect() Ignoring in this state : " + this.socketStatus);
			}
		};

		/**
		* @summary Retrieves the current status of this session
		* @returns String
		*/
		this.getStatus = function () {
			return this.sessionStatus;
		};

		/**
		* @summary Triggered when the WebSocket connection is opened
		* @event
		* @param {Event} evt event
		* @private
		*/
		this.onWebSocketOpen = function (evt) {
			console.debug("[" + new Date().toUTCString() + "] " + "Session.onWebSocketOpen()");
			this.socketStatus = this.WebSocketStatus.CONNECTED;
			if ( ( this.wsRestoreInProgress == true ) && 
			     ( !this.config.providerConfig.sendRegisterOnRecovery ) )
			{
				//create ws only session
				this.ws_only = true;
				this.needAuthOnReRegister = true;
				console.debug("Setting up to create ws only session");
			}
			this.adapter.createSession();
		};

		/**
		* @summary Triggered when the WebSocket connection is closed
		* @event
		* @param {Event} evt event
		* @private
		*/
		this.onWebSocketClose = function (evt) {
			console.debug("[" + new Date().toUTCString() + "] " + "Session.onWebSocketClose(), evt = " + evt);
			var event = {name: evt.data};

			if ( ( this.closePending == true ) &&
                             ( this.socketStatus == this.WebSocketStatus.CONNECTED ) )
                        {
                                // This close is for a service continuity register timeout.  Ignore
                                // it since the needed processing was done at the time of the original
                                // register refresh timeout.
                                console.log("Ignoring register refresh timeout late close");
                                this.closePending = false;
                                return;
                        }

			// clear register refresh timer if running
			clearTimeout( this.adapter.refresh_timer );
			// clear register response time if running
			clearTimeout( this.adapter.registerResponseTimer );
			// clear sendPingMessage timer/interval if running
			clearTimeout(this.sendPingMessageTimer);
			clearInterval(this.sendPingMessageInterval);

			// clear MDSP contacts including subscription timers.
			if ( this.mdsp.isFeatureEnabled() )
			{
				this.mdsp.clearMDSPcontacts();
			}

                        if ( (this.socketStatus == this.WebSocketStatus.CONNECTED) &&
                             ( this.recoveryAttemptsRemaining != 0 ) &&
                             ( this.config.providerConfig.networkRetryInterval != 0 ) &&
                             ( this.calls[0] ) )
                        {
                                // Try to re-establish ws connection/session before
                                // informing application if there is a call that can
                                // be recovered and service continuity is active in
                                // config data
                                console.log( "Getting timer to retry ws connection");
                                setTimeout( function() { self.connect(); }, ( config.providerConfig.networkRetryInterval * 1000 ) );
                                this.recoveryAttemptsRemaining --;
                                this.wsRestoreInProgress = true;
                                this.socketStatus = this.WebSocketStatus.DISCONNECTED;
                                return;
                        }


			if (this.socketStatus !== this.WebSocketStatus.CONNECTED) {
				console.error("Network failure");
			} else {
				//TODO How to distinguish the closing of WebSocket connection done by the client or by the server.
				event = {name: this.sessionStatus};
				this.callback.onStatus(this.sessionStatus, event);
				this.callback.onDisconnected(event);
			}
			this.socketStatus = this.WebSocketStatus.DISCONNECTED;
		};

		/**
		* @summary Triggered when an error occurs on the WebSocket connection
		* @event
		* @param {Event} evt event
		* @private
		*/
		this.onWebSocketError = function (evt) {
			console.error("Network failure");
			console.debug("Session.onWebSocketError() network failure, evt = " + evt);

			// clear register refresh timer if running
			clearTimeout( this.adapter.refresh_timer );

			this.socketStatus = this.WebSocketStatus.DISCONNECTED;

			if ( ( this.recoveryAttemptsRemaining != 0 ) && 
			     ( this.config.providerConfig.networkRetryInterval != 0 ) &&
				 ( this.calls[0] ) )
			{
				// Try to re-establish ws connection/session before 
				// informing application if there is a call that can
				// be recovered and service continuity is active in 
				// config data
				console.log( "Getting timer to retry ws connection");
				setTimeout( function() { self.connect(); }, ( config.providerConfig.networkRetryInterval * 1000 ) );
				this.recoveryAttemptsRemaining --;
				this.wsRestoreInProgress = true;
			}
			else
			{
				var event = {name: SessionError.NETWORK_ERROR};
				this.callback.onError(SessionError.NETWORK_ERROR, event);
				this.wsRestoreInProgress = false;
			}

		};

		/**
		* @summary Triggered when a message is received through the WebSocket connection
		* @event
		* @param {MessageEvent} evt event
		* @private
		*/
		this.onWebSocketMessage = function (evt) {
			var data = evt.data;

			// CRLF Keep Alive response from server. Ignore it.
			if(data === '\r\n') {
				console.debug('received WebSocket message with CRLF Keep Alive response');
				this.isReceivePong = true;
				clearTimeout(this.sendPingMessageTimer);
				return;
			}

			// WebSocket binary message.
			else if (typeof data !== 'string') {
				try {
					data = String.fromCharCode.apply(null, new Uint8Array(data));
				} catch(evt) {
					console.warn('received WebSocket binary message failed to be converted into string, message discarded');
					return;
				}
			}

			// WebSocket text message.
			else {
			}

			//Convert short SIP headers to long form. 
			data = data.replace(/^l:/gm, "Content-Length:");
			data = data.replace(/^v:/gm, "Via:");
			data = data.replace(/^t:/gm, "To:");
			data = data.replace(/^f:/gm, "From:");
			data = data.replace(/^i:/gm, "Call-ID:");
			data = data.replace(/^e:/gm, "Content-Encoding:");
			data = data.replace(/^m:/gm, "Contact:");

			console.debug("[" + new Date().toUTCString() + "] " + "Session.onWebSocketMessage() message:\n" + data);
			this.adapter.received(data);
		};

		/**
		* @summary Triggered when a page mode message fails to be sent to the callee
		* @event
		* @param {Event} evt event
		*/
		this.onPageModeChatMessageFailed = function (evt) {
			var call = this.getCall(evt.callId);
			if (call === null) {
				console.warn("Session received a SIP response for a unknow page mode chat message. Ignore it.");
				return;
			}
			var event = {to: call.to};
			this.callback.onPageModeChatMessageFailed(call.message, event);
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}

		
		/**
		* @summary Triggered when a page mode message is sent to the callee successfully
		* @event
		* @param {Event} evt event
		*/
		this.onPageModeChatMessageSent = function (evt) {
			var call = this.getCall(evt.callId);
			if (call === null) {
				console.warn("Session received a SIP response for a unknow page mode chat message. Ignore it.");
				return;
			}
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}

		/**
		* @summary Triggered when a sms message is sent to the callee successfully
		* @event
		* @param {Event} evt event
		*/		
		this.onSmsMessageSent = function (evt) {
			console.info("call onSmsMessageSent");
			var call = this.getCall(evt.callId);
			if (call === null) {
				console.warn("Session received a SIP response for an unknown sms message. Ignore it.");
				return;
			}
			
			var event = {to: call.to, from: evt.from, imdnMessageID: evt.imdnMessageID, dateTime: evt.dateTime, status:evt.status};
			console.info("call.to: " + call.to);
			console.info("evt.from: " + evt.from);
			console.info("call.message: " + call.message);
			this.callback.onSmsMessageSent(call.message, event);
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}

		/**
		* @summary Triggered when a sms message fails to be sent to the callee
		* @event
		* @param {Event} evt event
		*/
		this.onSmsMessageFailed = function (evt) {
			var call = this.getCall(evt.callId);
			var imdnMessageID = evt.imdnMessageID;
			if (call === null) {
				console.warn("Session received a SIP response for an unknown sms message. Ignore it.");
				return;
			}
			var event = {to: call.to, imdnMessageID:imdnMessageID};
			console.info("call.message: " + call.message);
			this.callback.onSmsMessageFailed(call.message, event);
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}
		
		/**
		* @summary Triggered when a sms IMDN message is sent to the callee successfully
		* @event
		* @param {Event} evt event
		*/	
		this.onSmsIMDNMessageSent = function (evt) {
			var call = this.getCall(evt.callId);
			if (call === null) {
				console.warn("Session received a SIP response for an unknown sms imdn message. Ignore it.");
				return;
			}

			var event = {from: evt.from, imdnMessageID: evt.imdnMessageID, dateTime: evt.dateTime, status:evt.status};
			console.info("call.to: " + call.to);
			console.info("evt.from: " + evt.from);
			this.callback.onSmsIMDNMessageSent(event);
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}
		
		/**
		* @summary Triggered when a sms IMDN message fails to be sent to the callee
		* @event
		* @param {Event} evt event
		*/
		this.onSmsIMDNMessageFailed = function (evt) {
			console.info("call onSmsIMDNMessageFailed");
			var call = this.getCall(evt.callId);
			var imdnMessageID = evt.imdnMessageID;
			if (call === null) {
				console.warn("Session received a SIP response for an unknown sms imdn message. Ignore it.");
				return;
			}
			
			var event = {from: evt.from, imdnMessageID: evt.imdnMessageID, dateTime: evt.dateTime, status:evt.status};
			console.info("call.to: " + call.to);
			console.info("evt.from: " + evt.from);
			this.callback.onSmsIMDNMessageFailed(event);
			
			for(var i=0; i < this.calls.length; i++) {
				if(this.calls[i].callId === call.callId){
					this.calls.splice(i, 1);
					break;
				}
			}
		}
		
        /**
        * Triggered when presence information is received.
        * This is a callback function that needs to be implemented 
        * in application layer
        * 
        * @param {Array} presenceInfo pidf XML or pidf-diff XML
        * @param {Event} event event data
        */
        this.onPresenceNotify = function (presenceInfo, event) {
        	this.callback.onPresenceNotify(presenceInfo, event);
        };

        /**
        * @summary Triggered when subscribe presence succeeds
        * @event
        */
        this.onSubscribePresenceSuccess = function (event) {
            var subscription = new PresenceSubscription(event.from, event.to, event.callId, event.cSeq, event.expires);
            this.presenceSubscriptions.push(subscription);
            if (typeof this.callback.onSubscribePresenceSuccess === 'function') {
                this.callback.onSubscribePresenceSuccess(event);
            }
        };

		/**
        * Triggered when subscription to presence fails. 
        * This is a callback function that needs to be implemented 
        * in application layer
        * 
        * @param {Event} event event data
        */
        this.onSubscribePresenceFailed = function (event) {
			if (typeof this.callback.onSubscribePresenceFailed === 'function') {
				this.callback.onSubscribePresenceFailed(event);
			}
        };

        /**
         * @summary Triggered when get presence succeeds
         * @event
         */
       this.onGetPresenceSuccess = function (event) {
           var subscription = new PresenceSubscription(event.from, event.to, event.callId, event.cSeq, event.expires);
           this.presenceSubscriptions.push(subscription);
           if (typeof this.callback.onGetPresenceSuccess === 'function') {
               this.callback.onGetPresenceSuccess(event);
           }
       };

        /**
        * Triggered when get presence fails. 
        * This is a callback function that needs to be implemented 
        * in application layer
        * 
        * @param {Event} event event data
        */
        this.onGetPresenceFailed = function (event) {
            if (typeof this.callback.onGetPresenceFailed === 'function') {
                this.callback.onGetPresenceFailed(event);
            }
        };


        /**
        * @summary Triggered when update presence succeeds
        * @event
        */
        this.onUpdatePresenceSuccess = function (event) {
            if (typeof this.callback.onUpdatePresenceSuccess === 'function') {
                this.callback.onUpdatePresenceSuccess(event);
            }
        };

		/**
        * @summary Triggered when update presence fails
        * @event
        */
        this.onUpdatePresenceFail = function (event) {
            if (typeof this.callback.onUpdatePresenceFail === 'function') {
                this.callback.onUpdatePresenceFail(event);
            }
        };

        this.getPresenceSubscription = function (from, callId, cSeq){
            var subscription = null, i;
            for (i=0; i< this.presenceSubscriptions.length; i++) {
                if (this.presenceSubscriptions[i].presentity.indexOf(from) != -1 &&
                    this.presenceSubscriptions[i].callId.match(callId)) {
                    subscription = this.presenceSubscriptions[i];
                    if (subscription.expires === 0) {
                        this.presenceSubscriptions.splice(i, 1);
                    }
                    break;
                }
            }
            return subscription;
        };
		
		/**
		* @summary Retrieves the Call instance referenced by it call Id
		* @param {string} callId Call ID
		* @param {orca.Call} Call instance
		* @private
		*/
		this.getCall = function (callId) {
			var call = null, i;
			for (i=0; i < this.calls.length; i+=1) {
			  if (this.calls[i].callId === callId) {
				  call = this.calls[i];
				  break;
			  }
			}
			return call;
		};

		this.setSessionStatus = function(status, errorInfo) {
			this.sessionStatus = status;
			var evt = {name: this.sessionStatus};
			if(errorInfo) {
				this.callback.onError(errorInfo, evt);
			}
			else if(status === SessionStatus.CONNECTED) {
				this.callback.onStatus(this.sessionStatus, evt);
				this.callback.onConnected();

				if ( (this.calls[0]) && ( this.wsRestoreInProgress ) )
				{
					if ( this.config.providerConfig.sendRegisterOnRecovery )
					{
						// transition to auto answer mode for some 
						// period of time to wait 
						// for invite from border
						console.log("Going to auto answer mode ");
						this.wsRestoreInProgress = false;
						this.autoAnswerMode = true;
						setTimeout( function() { self.autoAnswerMode = false; }, this.config.providerConfig.autoAnswerTime * 1000 );
						
					}
					else
					{
						// send re-invite to recover
						console.log("Service Continuity: Call exists... create a new offer") ;
						this.calls[0].callDirection = this.calls[0].CallDirection.OUTGOING ;
						console.log("setting restoredCall to true");
						this.calls[0].restoredCall = true;
						this.wsRestoreInProgress = false;
						this.calls[0].createSDPOffer();
					}
				}
			}
			else if(status === SessionStatus.DISCONNECTED) {
				this.callback.onStatus(this.sessionStatus, evt);
				this.callback.onDisconnected();
			}
			else {
				this.callback.onStatus(this.sessionStatus, evt);
			}
		};

		this.incomingSessionEvent = function(evt) {
			var call = this.getCall(evt.callId);
			if(!call){
				if(evt.name === 'invitation') {
					call = this.callback.createCall(null, null, this); //call is orca.Call here
					call.getCallImp().incomingCallSessionEvent(evt);
				}
				else if (evt.name === 'message'){
					if (evt.contentType === 'message/cpim') {
						//sms message or imdn message: imdn:message/imdn+xml												
						if (evt.bodyContentType === 'message/imdn+xml') {
							//receive imdn message							
							this.adapter.sendSmsIMDNMessageResponse(evt.uaCall, 200);// send 200OK for receiving IMDN message
							var event = {callId: evt.callId, from: evt.from, message: evt.message, imdnMessageID: evt.imdnMessageID, dateTime: evt.dateTime, status: evt.status};
							this.callback.onIncomingSmsIMDNMessage(event);
						} else {
							//receive sms message
							this.adapter.sendSmsMessageResponse(evt.uaCall, 200);// check parameter, if error send 4xx/5xx
							this.callback.onIncomingSmsMessage(evt);
						}
						return;						
					}
					this.adapter.sendPageModeChatMessageResponse(evt.uaCall, 200);
					//Nothing to do if it is indication message
					if (evt.contentType === 'application/im-iscomposing+xml' &&
						isMessageCompositionIndication(evt.message)) {
						return;
					}
					this.callback.onIncomingPageModeChat(evt);
				
				}
				else {
					console.warn('no call found for ' + evt.name);
					return;
				}
			}
			else if(evt.name === 'invitation') {
				call.incomingCallSessionEvent(evt);
			}
			else
				console.warn('unknown event');
		};

	}


   	function PresenceSubscription(from, to, callId, cSeq, expires) {
		this.watcher = from;
		this.presentity = to;
		this.callId = callId;
		this.cSeq = cSeq;
		this.expires = expires;
	}

	/**
	* @summary Provides access to methods for managing an outgoing or incoming call
	* @classdesc Calls objects are obtained by calling the createCall method or handling the onIncoming event of a connected {@Link orca.Session} instance
	* @Constructor
	* @memberOf orca
	*/
	function Call(to, mediatypes, session, callback) {
		this.callback = callback;

	   /**
		*
		* @summary Possible internal states of a Call
		* @typedef CallStatus
		* @type enum
		* @property {string} IDLE Call is idle
		* @property {string} PREPARING_OFFER Call's SDP offer is preparing (waiting for ICE canditates)
		* @property {string} CALLING Call is establishing
		* @property {string} PREPARING_ANSWER Call's SDP answer is preparing (waiting for ICE canditates)
		* @property {string} ACCEPTED Call is accepted
		* @property {string} CONFIRMED Call is established
		* @property {string} CANCELING Call is canceling
		* @property {string} CANCELED Call is canceled
		* @property {string} FAILED An error occurs during the call establishment
		*/

		this.CallStatus = {};
		this.CallStatus.IDLE = 'idle';
		this.CallStatus.PREPARING_OFFER = 'prep-offer';
		this.CallStatus.CALLING = 'calling';
		this.CallStatus.RINGING = 'ringing';
		this.CallStatus.PREPARING_ANSWER = 'prep-answer';
		this.CallStatus.ACCEPTED = 'accepted';
		this.CallStatus.CONFIRMED = 'confirmed';
		this.CallStatus.CANCELING = 'canceling';
		this.CallStatus.CANCELED = 'canceled';
		this.CallStatus.FAILED = 'failed';
		this.CallStatus.REFUSED = 'refused';
		this.CallStatus.TERMINATING = 'terminating';
		this.CallStatus.HOLD = 'hold';
		this.CallStatus.REMOTE_HOLD = 'remote hold';
		this.CallStatus.UPGRADING = 'upgrading';
		this.CallStatus.DOWNGRADING = 'downgrading';

	   /**
		*
		* @summary Possible call direction
		* @typedef CallDirection
		* @type enum
		* @property {string} INCOMING incoming call
		* @property {string} OUTGOING outgoing call
		*/

		this.CallDirection = {};
		this.CallDirection.INCOMING = 'i';
		this.CallDirection.OUTGOING = 'o';

	   /**
		*
		* @summary Possible media direction
		* @typedef MediaDirection
		* @type enum
		* @property {string} SENDRECV Receives and sends media stream
		* @property {string} SENDONLY Sends only media stream
		* @property {string} RECVONLY Receives only media stream
		*/

		this.MediaDirection = {};
		this.MediaDirection.SENDRECV = 'sendrecv';
		this.MediaDirection.SENDONLY = 'sendonly';
		this.MediaDirection.RECVONLY = 'recvonly';
		this.MediaDirection.INACTIVE = 'inactive';

		/**
		* List of remote streams associated with this call.
		* @type {orca.ManagedStream[]}
		* @private
		*/
		this.managedStreams = [];

		/**
		 * List of ICE Servers.
		 * @type {object}
		 * @private
		 */
		//this.iceServers = [{"url": "STUN stun.l.google.com:19302"}];
		this.iceServers = null;

		/**
		 * Peer connection.
		 * @type {RTCPeerConnection}
		 * @private
		 */
		this.pc = null;

		/**
		 * Parent session.
		 * @type {orca.Session}
		 * @private
		 */
		this.session = session;

		/**
		 * Call status for internal state.
		 * @type {orcaALU.Call.CallStatus}
		 * @private
		 */
		this.callStatus = this.CallStatus.IDLE;

		/**
		 * Call status.
		 * @type {CallStatus}
		 * @private
		 */
		this.callStatusExternal = this.CallStatus.DISCONNECTED;

		/**
		 * Call direction.
		 * @type {CallDirection}
		 * @private
		 */
		this.callDirection = undefined;

		/**
		 * Saved SDP Offer.
		 * @type {string}
		 * @private
		 */
		this.sdpOffer = undefined;

		/**
		 * Call unique ID.
		 * @private
		 */
		this.callId= undefined;

		/**
		 * Flag indicating that the call is established.
		 * @type {string}
		 * @private
		 */
		this.activeCall = false;

		/**
		 * SIP User Agent used for calling.
		 * @type {sip.UserAgent}
		 * @private
		 */
		this.uaCall = null;

		/**
		 * Target Address Of Record (AOR).
		 * @type string[]
		 * @private
		 */
		this.targetAOR = (typeof to == 'string' ? [to] : to);

		/**
		 * Media types.
		 * @type string
		 * @private
		 */
		this.mediaTypes = mediatypes;
		this.oldMediaTypes = mediatypes;

		/**
		 * Audio media direction.
		 * @type string
		 * @private
		 */
		this.audioMediaDirection = undefined;

		/**
		 * Video media direction.
		 * @type string
		 * @private
		 */
		this.videoMediaDirection = undefined;

		/**
		 * Flag indicating whether waiting for ICE before sending SDP
		 * @type bool
		 * @private
		 */
		this.waitingIce = false;

		/**
		* Remote peers attached to this call.
		* @type PeerIdentity[]
		*/
		this.remotePeerIds = [];

		/**
		* Flag for whether call might have ALU tiled video
		* @type bool
		*/
		this.isTiledVideo = false;

		/**
		* Buffer of DTMF tones to be sent via SIP INFO method
		* @type string
		*/
		this.dtmfSipBuffer = '';

		/**
		* Flag for whether SIP INFO DTMF should be sent
		* @type bool
		*/
		this.dtmfSip = (this.session.config.providerConfig.dtmf !== 'inband');

		/**
		* Flag for whether inband DTMF should be sent
		* @type bool
		*/
		this.dtmfInband = (this.session.config.providerConfig.dtmf !== 'sip');

		/*
		* Flags to indicate whether a hold or resume is pending
		*/
		this.holdPending = false;
		this.resumePending = false;

		this.telephoneEvent = null;
		this.crypto = null;

		this.inviteCount = 0;
		this.initialHoldOffer = false;

		/*
		 * MSID semantic
		 */
		this.currNonZeroPortCount = 0 ;
		this.MSID = "undefined" ;

		/* 
		 * Service Continuity
		 */
		this.restoredCall = false;
		this.localAudioCodecs = [];
		this.localVideoCodecs = [];

		/*
		 * MDSP (Multiple Devices Shared PUID)
		 */
		this.pullCallInfo = undefined;
		this.bodilessReInvite = false;
		this.videoIceUfrag = '';
		this.videoIcePwd = '';

		/**
		 * Data Channel.
		 * @type {RTCPeerConnection}
		 * @private
		 */		
		 this.dataChannel = null;

		var self = this;



		// Call.id() is implemented in orca.js

		/**
		* Gets the identities of the remote peers attached to this call
		* @returns {PeerIdentity[]}
		*/
		this.remoteIdentities = function () {
			return this.remotePeerIds;
		};

                this.getpc = function () {
                        return this.pc ;
                }

		this.dumpCallInfo = function () {
			var pc = this.getpc() ;
			var rs, i ;
			rs = pc.getRemoteStreams() ;
			console.log( "Number of remote streams: " + rs.length) ;

			for( i=0 ; i < rs.length ; i++) {
				console.log( "Stream #" + i) ;
				console.log( rs[i]) ;

				var tracks, j ;
				tracks = rs[i].getAudioTracks() ;
				console.log( "# of audio tracks: " + tracks.length) ;
				for( j=0 ; j < tracks.length ; j++) {
					console.log( "track #" + j + ", info:") ;
					console.log( tracks[j]) ;
				}

				tracks = rs[i].getVideoTracks() ;
				console.log( "# of video tracks: " + tracks.length) ;
				for( j=0 ; j < tracks.length; j++) {
					console.log( "track #" + j + ", info:") ;
					console.log( tracks[j]) ;
				}
				console.log( "\n-- End of output for Stream #" + i) ;
			}
		};

		/**
		* Adds a local media stream to the call
		* Media stream instances are obtained from the browser's getUserMedia() method.
		* Local media streams should be added using this method before the connect method
		* is called to either initiate a new call or answer a received call.
		* (NOTE: Possible to accept RTCMediaStream as parameter to this method and
		* create ManagedStream internally)
		* @param {orca.ManagedStream} stream local media stream
		*/
		this.addStream = function (managed) {
			var streams, audioTracks;
			if (this.callStatus === this.CallStatus.HOLD || this.callStatus === this.CallStatus.REMOTE_HOLD) {
				console.debug('addStream() impossible during call hold');
				return false;
			}
			if ((this.callStatus === this.CallStatus.CONFIRMED) || (this.callStatus === this.CallStatus.ACCEPTED)) {
				this.callDirection = this.CallDirection.OUTGOING;
			}
			if(this.pc){
				streams = this.pc.getLocalStreams();
				if (streams.length > 0) {
					this.pc.removeStream( streams[0]);
					console.debug('addStream() removeStream: ' + streams[0].id + '/' + streams.length);
				}
			}
			// destroy the PeerConnection before creating a new one to work around some chrome issue when switching between audio and video
			if(this.session.config.providerConfig.persistentPC === false){
				console.debug('addStream() close peerconnection');
				if(this.pc){
					this.pc.close();
					this.pc = null;
				}
			}
			if (!this.pc) {
				console.debug('addStream() create new PeerConnection');
				this.createPeerConnection();
			}
			this.pc.addStream(managed.stream());
			this.mediaTypes = managed.type();

			this.dtmfSender = null;
			if (this.dtmfInband) {
				audioTracks = managed.stream().getAudioTracks();
				if (audioTracks.length > 0) {
					try {
						this.dtmfSender = this.pc.createDTMFSender(audioTracks[0]);
					} catch (e) {
						this.dtmfSender = null;
						console.warn('Call.connect() inband DTMF not supported by browser');
					}
				}
			}
			return true;
		};

		/**
		* Attempts to reach the call recipient and establish a connection
		* For an incoming call, calling this method explicitly joins/accepts the call
		*/
		this.connect = function () {
			if (this.callStatus === this.CallStatus.HOLD || this.callStatus === this.CallStatus.REMOTE_HOLD) {
				console.debug("Call.connect() impossible during call hold");
				return false;
			}
			console.debug("Call.connect()");
			
			console.debug("---------- The Call Connect parameters begin ----------");
			for (var i=0; i < this.targetAOR.length; i++) {
				console.debug("targetAOR: " + this.targetAOR[i]);
			}
			console.debug("oldMediaTypes: " + this.oldMediaTypes);
			console.debug("mediaTypes: " + this.mediaTypes);
			console.debug("---------- The Call Connect parameters end ----------");
			
			
			if (this.pc) {
				//var localStreams = this.callback.streams('local');
				//this.pc.addStream(localStreams[0].stream());
				if (this.callDirection === this.CallDirection.INCOMING) {
					this.accept();
				} else {
					this.sendCallOffer();
				}
			} else {
				console.warn("Call.connect() Peer connection is not created");
			}
			return true;
		};

		/**
		* Ends an active call
		*
		*/
		this.disconnect = function () {
			console.debug("Call.disconnect() status: " + this.callStatus);
			// this.session.adapter.terminateCallSession(this);

			this.session.needAuthOnReRegister = false;

			if ((this.callStatus === this.CallStatus.IDLE) || this.callStatus === this.CallStatus.RINGING || this.callStatus == this.CallStatus.PREPARING_OFFER) {
				if(this.callDirection === this.CallDirection.OUTGOING){
					this.session.adapter.cancelCallSession(this);
					this.callStatus = this.CallStatus.CANCELING;
				}
				else if (this.callDirection === this.CallDirection.INCOMING) {
					this.session.adapter.rejectCallSession(this);
					this.callStatus = this.CallStatus.REFUSED;
					this.callStatusExternal = CallStatus.REJECTED;
				}
			// } else if ((this.callStatus === this.CallStatus.CONFIRMED) || (this.callStatus === this.CallStatus.ACCEPTED) || (this.callStatus === this.CallStatus.HOLD) || (this.callStatus === this.CallStatus.REMOTE_HOLD)) {
				// this.session.adapter.terminateCallSession(this);
			// } else if (this.callStatus === this.CallStatus.CALLING || this.callStatus == this.CallStatus.PREPARING_ANSWER) {
				// console.debug("Call.disconnect() [callStatus = " + this.callStatus + "active: " + this.activeCall);
				// this.session.adapter.terminateCallSession(this);
			} else {
				console.debug("Call.disconnect() [activeCall = " + this.activeCall + ", callStatus = " + this.callStatus + ", callDirection = " + this.callDirection + "]");
				if(this.callDirection === this.CallDirection.INCOMING && !this.activeCall){
					this.session.adapter.rejectCallSession(this);
					this.callStatus = this.CallStatus.REFUSED;
					this.callStatusExternal = CallStatus.REJECTED;
				}
				else {
					this.callStatus = this.CallStatus.FAILED;
					this.callStatusExternal = CallStatus.DISCONNECTED;
					this.session.adapter.terminateCallSession(this);
				}
			}
		};

		/**
		* Called when a user does not wish to accept an incoming call
		*
		*/
		this.reject = function () {
			console.debug("Call.reject()");
			if(this.activeCall === true){
				this.callStatus = this.CallStatus.PREPARING_ANSWER;
				this.markActionNeeded();
				return;
			}
			this.callStatus = this.CallStatus.REFUSED;
			this.callStatusExternal = CallStatus.REJECTED;
			// this.session.adapter.sendResponse(480, 'Temporarily Unavailable');
			this.session.adapter.rejectCallSession(this);
		};
		// Call.streams() is implemented in orca.js


		/**
		* IMPLEMENTATION LAYER ONLY Retrieves a list of remote streams associated with this call.
		* @returns {orca.ManagedStream[]}
		*/
		this.remoteStreams = function () {
			return this.managedStreams;
		};

		/**
		* Retrieves the current status of this call
		* @returns {CallStatus}
		*/
		this.getStatus = function () {
			return this.callStatusExternal;
		};

		/**
		* Gets the media stream types used in this call
		* @returns {string}
		*/
		//TODO: discuss API change with Orca working group
		this.getMediaTypes = function () {
			return this.mediaTypes;
		};

		/**
		* Add a new participant to a group call of which you are the initiator.
		* @param {string} target The user to add
		*/
		//TODO: discuss API change with Orca working group
		this.addParticipant = function (target) {
			this.session.adapter.doRefer(this, target, true);
		};

		/**
		* Remove a participant from a group call of which you are the initiator.
		* @param {string} target The user to remove
		*/
		//TODO: discuss API change with Orca working group
		this.removeParticipant = function (target) {
			this.session.adapter.doRefer(this, target, false);
		};

		/**
		* Send DTMF.
		* @param {string} dtmf The DTMF to send
		*/
		//TODO: discuss API change with Orca working group
		this.sendDTMF = function (dtmf) {
			var duration = this.session.config.providerConfig.dtmfDuration;
			var gap = this.session.config.providerConfig.dtmfGap;			
			console.debug("sendDTMF dtmfDuration: " + duration);
			console.debug("sendDTMF dtmfGap: " + gap);
			console.debug("sendDTMF " + dtmf);
			if (this.activeCall === true) {
				if (this.dtmfInband) {
					if (this.dtmfSender) {
						try {
							this.dtmfSender.insertDTMF(dtmf, duration, gap);
						} catch (e) {
							console.error('Error from insertDTMF: ' + e.message);
							// Chrome throws error if other party does not accept telephone-event in SDP
						}
					} else {
						console.error('Could not send inband DTMF');
					}
				}
				if (this.dtmfSip) {
					if (this.dtmfSipBuffer.length > 0) {
						this.dtmfSipBuffer += ',' + dtmf;
					} else {
						this.dtmfSipBuffer = dtmf;
						this.sendDTMFBuffer();
					}
				}
			}
		};

		/**
		* Send DTMF tones in the buffer using SIP INFO method.
		*/
		this.sendDTMFBuffer = function () {
			var gap = self.session.config.providerConfig.dtmfGap;
			console.debug("sendDTMFBuffer dtmfGap: " + gap);
			var c;
			if (self.dtmfSipBuffer.length > 0) {
				c = self.dtmfSipBuffer[0];
				self.dtmfSipBuffer = self.dtmfSipBuffer.substring(1);
				if (c === ',') {
					gap = 2000;
				} else {
					self.session.adapter.sendDTMFSip(self, c);
				}
				if (self.dtmfSipBuffer.length > 0) {
					setTimeout(self.sendDTMFBuffer, gap);
				}
			}
		};

		/**
		* Blind transfer a call via SIP REFER request.
		* @param {string} target the user identifier to transfer the call to
		*/
		//TODO: discuss API change with Orca working group
		this.transfer = function (target) {
			this.session.adapter.doRefer(this, target, true)
		};

		/**
		* Upgrade to audiovideo call
		*/
		//TODO: discuss API change with Orca working group
		this.startVideo = function () {
			this.updateCall({audio:undefined, video:"sendrecv"});
		};

		/**
		* Downgrade to audio call
		*/
		//TODO: discuss API change with Orca working group
		this.stopVideo = function () {
			this.updateCall({audio:undefined, video:"none"});
		};

		/**
		* @summary Change media stream directions
		* @private
		*/
		this.updateCall = function (params) {
			var reinvite = false;
			var has_audio = false;
			var has_video = false;

			// update call's audio stream
			if (params.audio !== this.audioMediaDirection) {
				console.debug("updateCall() audio: " + this.audioMediaDirection + " => " + params.audio);
				reinvite = true;
				this.audioMediaDirection = params.audio;
			}
			// update call's video stream
			if (params.video !== this.videoMediaDirection) {
				console.debug("updateCall() video: " + this.videoMediaDirection + " => " + params.video);
				reinvite = true;
				this.videoMediaDirection = params.video;
			}

			if (params.audio === undefined) {
				has_audio = false;
			} else {
				has_audio = true;
			}

			if (params.video === undefined) {
				has_video = false;
			} else {
				has_video = true;
			}

			if (has_audio === true) {
				if (has_video === true) {
					this.mediaTypes = 'audio,video';
				} else {
					this.mediaTypes = 'audio';
				}
			} else {
				if (has_video === true) {
					this.mediaTypes = 'video';
				} else {
					this.mediaTypes = '';
				}
			}

			if (reinvite) {
				this.sendCallOffer();
			}
		};

		/**
		* @summary Sends a SIP request INVITE to make a call.
		* @private
		*/
		this.sendCallOffer = function () {
			var idx;
			console.debug("Call.invite(): oldMediaTypes=" + this.oldMediaTypes + "; current mediaTypes=" + this.mediaTypes);
			this.callDirection = this.CallDirection.OUTGOING;
			if(this.targetAOR.length > 1)
				this.isTiledVideo = this.mediaTypes.indexOf('video') > -1;
			for (idx=0; idx < this.targetAOR.length; idx+=1) {
			    this.remotePeerIds.push({id:this.targetAOR[idx]});
			}
			this.markActionNeeded();
		};

		/**
		* Places a call on hold
		*/
		this.hold = function (type) {
			if (this.callStatus === this.CallStatus.HOLD || this.callStatus === this.CallStatus.REMOTE_HOLD) {
				console.debug('Call.hold() impossible, already on hold');
				return false;
			}
			console.debug("Call.hold() type = " + type);
			if (type === undefined) {
				type = 'inactive';
			}
			if (type != 'sendonly' && type != 'inactive') {
				console.debug("Call.hold invalid type = ", + type);
				return false;
			}
		
			var updateDict = {} ;
			if (this.mediaTypes.indexOf('audio') !== -1) {
				updateDict['audio'] = type ;
			}

			if (this.mediaTypes.indexOf('video') !== -1) {
				updateDict['video'] = type ;
			}


			this.holdPending = true;
			this.updateCall(updateDict) ;
			return true;
		};

		/**
		* Takes a call off hold
		*/
		this.resume = function () {
			if (this.callStatus !== this.CallStatus.HOLD) {
				console.debug('Call.resume() impossible, no local hold');
				return false;
			}
			console.debug("Call.resume()");
			
			if ( ( this.mediaTypes.indexOf('video') === -1 ) &&
				 ( this.mediaTypes.indexOf('audio') === -1 ) )
			{
				console.debug("Call.hold invalid mediaTypes=", + this.mediaTypes);
				return false;
			}
			
			this.resumePending = true;
			
			var updateDict = {} ;
			if (this.mediaTypes.indexOf('audio') !== -1) {
				updateDict['audio'] = "sendrecv" ;
			}

			if (this.mediaTypes.indexOf('video') !== -1) {
				updateDict['video'] = "sendrecv" ;
			}

			this.updateCall(updateDict) ;
			return true;
		};


		/**
		* @private
		*/
		this.markActionNeeded = function () {
			this.actionNeeded = true;
			var self = this;
			this.doLater(function () {
				self.onStableStatus();
				self.dumpCallInfo();
			});
		};

		/**
		* @summary Post an event to myself so that I get called a while later.
		* @param {function} what Function to run later
		* @private
		*/
		this.doLater = function (what) {
			setTimeout(what, 1);
		};


		this.determineWaitingIce = function (sdp) {
			var mLines = sdp.sdp.split("\r\nm=") ;
			var i ;
			if(mLines.length >=2) {
				for(i=1; i <mLines.length; i++) {
					if (mLines[i].indexOf(" 0 RTP/") === -1 && mLines[i].indexOf("\r\na=candidate:") === -1) {
						console.trace("m= line " + i + " does not have ice-candidates.. setting self.waitingIce to true") ; 
						self.waitingIce = true ;
						break ;
					} else {
						console.trace("m= line " + i + " already has ice-candidates or m= line has port zero") ; 
					}
				}
			} else {
				console.trace("ERROR: local SDP does not have any m= lines. mLines.length="+mLines.length) ;
			}
		}

		/**
		* @summary Internal function called to parse SDP and determine the media type
		* @private
		*/
		this.mediaTypeFromSdp = function(sdpString) {
			var mediatypes = undefined, properties, i;
			var acceptType = (/a=dcsa:[0-9]*:[0-9]* accept-types:(.*)\r\n/).exec(sdpString);
			var fileName = null;
			var fileType = null;
			
			if (acceptType) {
				acceptType = acceptType[1];
			}
			console.log("parsed accept-types: " + acceptType + ", type: " + typeof acceptType);
			
			var fileSelector = (/a=dcsa:[0-9]*:[0-9]* file-selector:name:"(.*)" type:(.*)\r\n/).exec(sdpString);
			if (fileSelector) {
//				for (var i=0; i < fileSelector.length; i++) {
//					console.log("file-selector " + i + ": " + fileSelector[i] + "\n");
//				}
				fileName = decodeURIComponent(fileSelector[1]);
				fileType = fileSelector[2];
				console.log("parsed file-selector name: " + fileName + ", type: " + fileType);
			}
			
			if (sdpString.search("m=audio") !== -1) {
				if ((sdpString.search("m=video") !== -1) && (sdpString.search("m=video 0") === -1)) {
					mediatypes = 'audio,video';
				} else {
					mediatypes = 'audio';
				}
			} else if (sdpString.search("m=video") !== -1) {
				mediatypes = 'video';
			} else if (sdpString.search("m=application") !== -1) {
				if (fileName === null){
					mediatypes = 'chat';
				} else if (acceptType.search("image") !== -1) {
					mediatypes = 'imageshare';
				} else {
					var fileExtension = (/\.(.*)/).exec(fileName)[1].toLowerCase();
					console.log("fileExtension: " + fileExtension);
					if (fileExtension.match(/jpg|bmp|gif|png/)) {
						mediatypes = 'imageshare';
					} else {
						mediatypes = 'filetransfer';
					}
				}
				console.log("parsed mediatypes: " + mediatypes);

				if (!this.msrpToPath && (this.callStatus === this.CallStatus.IDLE || this.callStatus === this.CallStatus.ACCEPTED)) {
					this.msrpToPath = (/a=dcsa:[0-9]*:[0-9]* path:([^\s]*)\r\n/).exec(sdpString);
					if (this.msrpToPath) {
						this.msrpToPath = this.msrpToPath[1];
					} else {
						this.msrpToPath = undefined;
					}
				}
				properties = (/a=dcsa:[0-9]*:[0-9]* file-selector:(.*)\r\n/).exec(sdpString);
				if (properties) {
					properties = properties[1].split(' ');
					this.msrpFileProperties = {};
					for (i = 0; i < properties.length; i++) {
						if (properties[i].indexOf(':') > -1) {
							this.msrpFileProperties[properties[i].split(':')[0]] = properties[i].split(':')[1];
						}
					}
					if (this.msrpFileProperties.name) {
						this.msrpFileProperties.name = fileName;
					}
				}
			} else {
				mediatypes = undefined;
			}
			return mediatypes;
		}

		/**
		* @summary Internal function called to set mediaTypes and oldMediaTypes when the call is established
		* @private
		*/
		this.setMediaTypeFromSdp = function(sdpString) {
			var mediatypes = this.mediaTypeFromSdp(sdpString);
			this.mediaTypes = mediatypes;
			this.oldMediaTypes = mediatypes;
		}

		this.setLDsuccessOnCreateOfferSuccess = function () {
                        console.debug('setLDsuccessOnCreateOfferSuccess(): setLocalDescription success: restoredCall = ' + self.restoredCall);
			self.callStatus = self.CallStatus.PREPARING_OFFER;
			self.callStatusExternal = CallStatus.CONNECTING;
			self.sdpOffer = sdpOffer.sdp;
			self.localAudioCodecs = self.getCodecsFromSDP(  self.sdpOffer, 'audio');
			self.localVideoCodecs = self.getCodecsFromSDP(  self.sdpOffer, 'video');
			self.markActionNeeded();
		};

		this.setLDsuccessOnCreateAnswerSuccess = function () {
			console.debug('setLDsuccessOnCreateAnswerSuccess(): setLocalDescription success: restoredCall = ' + self.restoredCall);
			self.callStatus = self.CallStatus.PREPARING_ANSWER;
			self.markActionNeeded();
		};

		this.setLDfailure = function( error) {
			console.error('setLocalDescription failure: ' + error);
			self.errorCallback(error);
		};

		this.createAnswerSuccess = function( sessionDescription) {
			var answerVideoIceUfrag;
			var answerVideoIcePwd;

			console.debug("unmodified local SDP from createAnswer:\n" + sessionDescription.sdp);
			sessionDescription = self.updateSDPCrypto( sessionDescription, 'answer');
			sessionDescription = self.updateSDPssrc( sessionDescription, 'answer');
			sessionDescription = self.updateSDPcodecs( sessionDescription, 'answer', 'audio',
                                                self.session.config.providerConfig.audioCodecs);
			sessionDescription = self.updateSDPcodecs( sessionDescription, 'answer', 'video',
                                                self.session.config.providerConfig.videoCodecs);
			sessionDescription = self.updateSDPOfferMediaBundle( sessionDescription, 'answer');
			sessionDescription = self.updateSDPBandwidth(sessionDescription, 'answer');
			self.pc.setLocalDescription( sessionDescription,
				self.setLDsuccessOnCreateAnswerSuccess,
				self.setLDfailure);
			self.localAudioCodecs = self.getCodecsFromSDP(  sessionDescription.sdp, 'audio');
			self.localVideoCodecs = self.getCodecsFromSDP(  sessionDescription.sdp, 'video');

			answerVideoIceUfrag = self.getSDPattrValue( sessionDescription.sdp, 'video', 'ice-ufrag:');
			answerVideoIcePwd = self.getSDPattrValue( sessionDescription.sdp, 'video', 'ice-pwd:');

			if (   ( answerVideoIceUfrag != self.videoIceUfrag )
			    || ( answerVideoIcePwd != self.videoIcePwd ) )
			{
				console.log( "new ICE Params on createAnswer:\n" +
					"\tprior videoIceUfrag = " + self.videoIceUfrag +
					"\t  New videoIceUfrag = " + answerVideoIceUfrag +
					"\tprior videoIcePwd   = " + self.videoIcePwd +
					"\t  New videoIcePwd   = " + answerVideoIcePwd);
				self.videoIceUfrag = answerVideoIceUfrag;
				self.videoIcePwd = answerVideoIcePwd;
			}

			console.trace("createAnswerSuccess() setLocalDescription sdp = " + sessionDescription.sdp);
			self.determineWaitingIce(sessionDescription);
		};

		this.createAnswerFailure = function( error) {
			console.error('createAnswer failure: ' + error);
			self.callStatus = self.CallStatus.FAILED;
			self.callStatusExternal = CallStatus.DISCONNECTED;
			self.errorCallback( error);
			self.markActionNeeded();
		};

		this.setRDsuccess = function() {
			console.debug('setRemoteDescription success');
			self.dumpCallInfo();
		}; 

		this.setRDfailure1 = function( error) {
			console.error('setRemoteDescription failure: ' + error);
			self.callStatus = self.CallStatus.FAILED;
			self.callStatusExternal = CallStatus.DISCONNECTED;
			self.errorCallback(error);
		};

		this.setRDfailure2 = function(error) {
			console.error('setRemoteDescription failure: ' + error);
			self.errorCallback(error);
		};


        this.getNonZeroPortCount = function(sdp) {
                var m, i, nonzeroport ;
                m = sdp.split('\r\nm=');

                nonzeroport = 0 ;
                for ( i = 1 ; i < m.length ; i++ ) {
                        port = m[i].match(/ \d* /) ;
                        if(port != 0) {
                                nonzeroport = nonzeroport+1 ;
                        }
                }

                return nonzeroport ;
        }

		this.updateMSID = function (sdp) {
			var m, i ;
			var newPortCount;
			var msid;

			/*
			v=0
			o=- 6794071255261666721 3 IN IP4 127.0.0.1
			s=-
			t=0 0
			a=msid-semantic: WMS 4Ph0Xa5szvq54TBCgAbBbQC6GTniSnoucPLn
			m=audio 52212 UDP/TLS/RTP/SAVPF 111 103 104 0 8 106 105 13 126
			c=IN IP4 135.244.18.152
			a=rtcp:1 IN IP4 0.0.0.0
			a=candidate:3458908503 1 udp 2122260223 135.244.18.152 52212 typ host generation 0
			a=candidate:2702239670 1 udp 2122194687 192.168.1.103 52213 typ host generation 0
			a=ice-ufrag:+RQWzyqKzmGji8mm
			a=ice-pwd:IM/kc9YRyUUVnSFKSQmY1Ci/
			a=fingerprint:sha-256 F1:F1:99:94:53:34:86:16:F7:A9:14:9F:82:C7:6A:E1:71:E1:AE:8A:0C:C5:16:DE:E0:6A:00:F6:BF:38:6F:0F
			a=setup:active
			a=mid:audio
			a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
			a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
			a=sendrecv
			a=rtcp-mux
			a=rtpmap:111 opus/48000/2
			a=fmtp:111 minptime=10
			a=rtpmap:103 ISAC/16000
			a=rtpmap:104 ISAC/32000
			a=rtpmap:0 PCMU/8000
			a=rtpmap:8 PCMA/8000
			a=rtpmap:106 CN/32000
			a=rtpmap:105 CN/16000
			a=rtpmap:13 CN/8000
			a=rtpmap:126 telephone-event/8000
			a=maxptime:60
			a=ssrc:3512838810 cname:qFAK5Ui2E2ULCvh0
			a=ssrc:3512838810 msid:4Ph0Xa5szvq54TBCgAbBbQC6GTniSnoucPLn 47a70447-0a9f-4d19-88f4-3c92b6f14977
			a=ssrc:3512838810 mslabel:4Ph0Xa5szvq54TBCgAbBbQC6GTniSnoucPLn
			a=ssrc:3512838810 label:47a70447-0a9f-4d19-88f4-3c92b6f14977
			m=video 52218 UDP/TLS/RTP/SAVPF 100 116 117
			c=IN IP4 135.244.18.152
			a=rtcp:1 IN IP4 0.0.0.0
			a=candidate:3458908503 1 udp 2122260223 135.244.18.152 52218 typ host generation 0
			a=candidate:2702239670 1 udp 2122194687 192.168.1.103 52219 typ host generation 0
			a=ice-ufrag:FhOts5GpoeDCNIxm
			a=ice-pwd:t1Tje+Sg9zT0f3SPanMYft37
			a=fingerprint:sha-256 F1:F1:99:94:53:34:86:16:F7:A9:14:9F:82:C7:6A:E1:71:E1:AE:8A:0C:C5:16:DE:E0:6A:00:F6:BF:38:6F:0F
			a=setup:active
			a=mid:video
			a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
			a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
			a=sendrecv
			a=rtcp-mux
			a=rtpmap:100 VP8/90000
			a=rtcp-fb:100 ccm fir
			a=rtcp-fb:100 nack
			a=rtcp-fb:100 nack pli
			a=rtcp-fb:100 goog-remb
			a=rtpmap:116 red/90000
			a=rtpmap:117 ulpfec/90000
			a=ssrc:3869371994 cname:qFAK5Ui2E2ULCvh0
			a=ssrc:3869371994 msid:4Ph0Xa5szvq54TBCgAbBbQC6GTniSnoucPLn 3faea071-f38f-4357-b723-93157cfcf1be
			a=ssrc:3869371994 mslabel:4Ph0Xa5szvq54TBCgAbBbQC6GTniSnoucPLn
			a=ssrc:3869371994 label:3faea071-f38f-4357-b723-93157cfcf1be

			*/

			switch ( self.session.config.providerConfig.msidHandling ) {
			case '0':
				/* With this setting, 'ssrc mapping' must also be disabled in SBLP profile. */
				console.debug("updateMSID(), msidHandling is 'Strip Incoming MSID (default)'.\n") ;
				sdp=sdp.replace(/a=msid-semantic.*\r\n/g, "");
				sdp=sdp.replace(/a=ssrc:.* label:.*\r\n/g, "") ; console.debug("a=ssrc.* label:.* -removed") ;
				sdp=sdp.replace(/a=ssrc:.* mslabel:.*\r\n/g, "") ; console.debug("a=ssrc.* mslabel:.* -removed") ;
				return sdp;
			case '1':
				break;
			case '2':
				console.debug("updateMSID() no change, msidHandling is 'None, no applicable handling'.\n") ;
				return sdp;
			default:
				console.debug("updateMSID() no change, msidHandling is 'Undefined' " + " (" +
						self.session.config.providerConfig.msidHandling + ")");
				return sdp;
			}

			console.debug("updateMSID(), msidHandling is 'Generate/Replace Incoming MSID'.\n") ;

			if(!sdp.match(/ssrc:\d* /)) {
				console.log("No ssrc lines... so not adding msid") ;
				return sdp ;
			}

			// MSID Chrome issue:
			// 	Chrome cares about MSID and related lines
			//	in reINVITEs, but not initial INVITE.
			// Workaround: Generate MSID for all incoming 
			// SDP offer/answer.
			// Do not trust received MSID values independent of
			// SBC or farend client generated them.
			// a. First, Simply remove a=msid-semantic, a=ssrc:*label, mislabel, msid 
			// b. Then generate random value for MSID and set
			//  	track/label as ordinal # of m= line.

			sdp=sdp.replace(/a=msid-semantic.*\r\n/g, "") ; console.debug("a=msid-semantic removed") ;
			sdp=sdp.replace(/a=ssrc:.* label:.*\r\n/g, "") ; console.debug("a=ssrc.* label:.* -removed") ;
			sdp=sdp.replace(/a=ssrc:.* mslabel:.*\r\n/g, "") ; console.debug("a=ssrc.* mslabel:.* -removed") ;
			sdp=sdp.replace(/a=msid:.*\r\n/g, "") ; console.debug("a=msid.* -removed") ;
			sdp=sdp.replace(/a=ssrc:.* msid:.*\r\n/g, "") ; console.debug("a=ssrc.* msid:.* -removed") ;

			m = sdp.split('\r\nm=');

			// WMS generation/reuse mechanism
			// first time: create WMS id, save it.
			// subsequent time:
			// 	check if # of unremoved (port !=0) m= lines change.
			// 	if yes then create a new wms id
			//	else reuse existing one
			
			newPortCount = this.getNonZeroPortCount(sdp) ;
			if(this.currNonZeroPortCount != newPortCount) {
				console.debug("currNonZeroPortCount=" + this.currNonZeroPortCount +
					"!= newPortCount=" + newPortCount + ". Generating new MSID") ;
				this.currNonZeroPortCount = newPortCount ;
				msid = "orca-wms-id-" + Math.round(Math.random()*100000000000) ;
				this.MSID = msid ;
				console.debug("Using new MSID generated '" + msid + "'") ;
			} else {
				msid = this.MSID ;
				console.debug("Using previous MSID '" + msid + "'") ;
			}

			m[0] = m[0]+"\r\na=msid-semantic: WMS " + msid ; 

			for ( i = 1 ; i < m.length ; i++ ) {
				var mm, a, assrc ;
				var CRLFPattern = new RegExp("\r\n$");

				mm = m[i] ;
				assrc = mm.match(/ssrc:\d* /) ;
				if(assrc) {
					console.log("a=ssrc found.'" + assrc + "'") ;

					a=mm.split("a=") ; // use "\r\na="
					msidline=assrc + "msid:" + msid + " " ;

					msidline=msidline + i + "\r\n"

					mslabelline=assrc + "mslabel:" + msid + "\r\n"
					labelline=assrc + "label:" + i;

					var j ;
					for(j=0; j <a.length; j++) {
						if(a[j].match(/^ssrc:/)) {
							if ( CRLFPattern.test( a[j]) == true ) {
								// attribute ends in CRLF so labelline gets CRLF at end
								labelline = labelline + "\r\n";
							}
							else {
								// attribute does not end in CRLF so add it to attribute itself
								a[j] = a[j] + "\r\n";
							}

							a.splice(j+1, 0, msidline, mslabelline, labelline) ;
							console.debug("Adding msid at position " + j) ;
							break ;
						}
					}
					m[i] = a.join("a=") ;
				}


			}
			sdp = m.join("\r\nm=") ;

			return sdp ;

		}
		
		/**
		 * @summary Return whether an SDP has the given direction at all levels (session and media), or for the media specified
		 * @param {string} sdp The SDP to check
		 * @param {string} direction The direction to check for. Can be 'sendrecv', 'sendonly', 'recvonly', or 'inactive'.
		 * @param {string} media The specific media type to check (optional)
		 * @private
		 */
		this.sdpHasDirection = function (sdp, direction, media) {
			var m, i, hasSessionAttribute,
				other = ['\r\na=sendrecv', '\r\na=sendonly', '\r\na=recvonly', '\r\na=inactive'];
			if (typeof sdp === 'string') {
				for (i = 0; i < other.length; i += 1) {
					if (other[i].slice(4) === direction) {
						other.splice(i, 1);
						break;
					}
				}
				if (other.length === 4) {
					console.warn('sdpHasDirection() Invalid direction ' + direction);
					return false;
				}
				function hasDirection(str) {
					return (str.indexOf('\r\na=' + direction) > -1);
				}
				function hasOther(str) {
					return (str.indexOf(other[0]) > -1 || str.indexOf(other[1]) > -1 || str.indexOf(other[2]) > -1);
				}
				m = sdp.split('\r\nm=');
				// Check session attribute
				hasSessionAttribute = hasDirection(m[0]) || (direction === 'sendrecv' && !hasOther(m[0]));
				if (m.length === 1) {
					if (media) {
						return undefined;
					}
					return hasSessionAttribute;
				}
				if (!media && !hasSessionAttribute && hasOther(m[0])) {
					return false;
				}
				// Check media attributes
				for (i = 1; i < m.length; i += 1) {
					if (media) {
						if (m[i].indexOf(media) === 0) {
							return (hasSessionAttribute ? !hasOther(m[i]) : hasDirection(m[i]));
						}
					} else if (hasSessionAttribute ? hasOther(m[i]) : !hasDirection(m[i])) {
						return false;
					}
				}
				if (media) {
					return undefined;
				}
				return true;
			}
			return false;
		};

		/**
		* @summary Internal function called when a stable state is entered by the browser (to allow for multiple AddStream calls or
		* other interesting actions).
		* @private
		*/
		this.onStableStatus = function () {
			console.debug("Call.onStableStatus() [actionNeeded = " + this.actionNeeded + ", waitingIce = " + this.waitingIce +", status = " + this.callStatus + ", callDirection = " + this.callDirection + ", activeCall = " + this.activeCall + "]");
			var mySDP, sdp, self;
			if (this.actionNeeded) {
				switch(this.callStatus) {
					case this.CallStatus.IDLE:
						this.createSDPOffer();
					   break;

					case this.CallStatus.PREPARING_OFFER:
						if (this.waitingIce) {
							return;
						}
						sdp = this.pc.localDescription.sdp;

						if (this.callDirection === this.CallDirection.INCOMING) {
							//Offer in 200 ok and using DTLS need to call this function updateSDPForDTLS. such as in Call transfer for transferAgent side.
							//outgoing parameter means outgoing INVITE request, not CallDirection.
							sdp = this.updateSDPForDTLS(sdp, 'outgoing');
							sdp = this.updateSDPCandidate(sdp, 'answer');
							this.session.adapter.sendResponse(this, 200, 'OK', sdp);
						} else {
							// convert between sdes and dtls
							sdp = this.updateSDPForDTLS(sdp, 'outgoing');
							sdp = this.updateSDPCandidate(sdp, 'offer');
							sdp = this.updateSDPDataChannel(sdp, 'offer');
							this.session.adapter.createCallSession(this, this.targetAOR, sdp);
							this.callStatus = this.CallStatus.CALLING;
							//TODO Not done: Retransmission on non-response.
						}
						break;

					case this.CallStatus.ACCEPTED:
						if (this.sdpOffer !== undefined) {
							this.sdpOffer = this.updateSDPForTempWorkarounds(this.sdpOffer, "offer");
							// we already received a SDP offer
							var remoteSdpOffer = this.sdpOffer;
							remoteSdpOffer = remoteSdpOffer.replace(/\r\na=setup:passive/g,''); //Chrome does not like this. It will cause setLocalDescription error
							// var idx = this.sdpOffer.indexOf('m=video 0');
							// if (idx !== -1) {
							//     remoteSdpOffer = this.sdpOffer.substring(0, idx);
							// }
							//TODO: temp workaround to remove unnecessary video codecs which will cause transfer party A not working
							// will revisit this to find root cause or rewrite regex to replace the sdp string.
							// if (remoteSdpOffer.indexOf('m=video') !== -1) {
							//     var index1 = this.sdpOffer.lastIndexOf('RTP/SAVPF 100 ');
							//     remoteSdpOffer = this.sdpOffer.substring(0, index1);
							//     remoteSdpOffer += 'RTP/SAVPF 100\n';
							//     index1 = this.sdpOffer.lastIndexOf('c=IN IP4 ');
							//     var index2 = this.sdpOffer.lastIndexOf('a=rtpmap:100');
							//     remoteSdpOffer += this.sdpOffer.substring(index1, index2);
							//     remoteSdpOffer += 'a=rtpmap:100 VP8/90000\n';
							//     index1 = this.sdpOffer.lastIndexOf('a=crypto:1');
							//     remoteSdpOffer += this.sdpOffer.substring(index1);
							// }
							var idx = this.sdpOffer.indexOf('m=video');
							if(idx !== -1 && this.sdpOffer.indexOf('VP8') === -1) {
								remoteSdpOffer = remoteSdpOffer.substring(0, idx);
								//remoteSdpOffer += 'm=video 0 RTP/SAVPF';
							}

							remoteSdpOffer=this.updateMSID(remoteSdpOffer);
							
							console.trace("onStableStatus() setRemoteDescription sdp = " + remoteSdpOffer);
							this.pc.setRemoteDescription(new RTCSessionDescription({type:'offer', sdp:remoteSdpOffer}),
								this.setRDsuccess,
								this.setRDfailure1);
							try {
								self = this;
								this.pc.createAnswer( this.createAnswerSuccess, this.createAnswerFailure);
							} catch (e) {
								console.error('Call.onStableStatus() webkitRTCPeerConnection can not create a SDP answer, exception = ' + e);
								self.callStatus = self.CallStatus.FAILED;
								self.callStatusExternal = CallStatus.DISCONNECTED;
								self.markActionNeeded();
							}

							//this.markActionNeeded(); //TODO: might need to move the call into callback if callStatus is not set in time
						} else {
							this.createSDPOffer();
						}
						break;

					case this.CallStatus.PREPARING_ANSWER:
						if (this.waitingIce) {
							return;
						}
						sdp = this.pc.localDescription.sdp;
						var idx = sdp.indexOf('m=video');
						if (idx === -1 && this.sdpOffer.indexOf('m=video') !== -1) { //downgraded. remote sdp offer has video or video 0
							sdp = sdp + 'm=video 0 RTP/SAVPF 0\nc=IN IP4 0.0.0.0\n';
						}
						sdp = this.updateSDPForDTLS(sdp, 'outgoing');
						sdp = this.updateSDPCandidate(sdp, 'answer');
						sdp = this.updateSDPDataChannel(sdp, 'answer');
						this.session.adapter.sendResponse(this, 200, 'OK', sdp);
						this.setMediaTypeFromSdp(sdp); // update mediaTypes when sending response.
						break;

					case this.CallStatus.CONFIRMED:
					case this.CallStatus.HOLD:
						if (this.activeCall === false) {
							this.activeCall = true;
						} else if ((this.activeCall === true) && (this.callDirection === this.CallDirection.OUTGOING)) {
							this.createSDPOffer();
						}
						break;
					case this.CallStatus.FAILED:
						if (this.activeCall === true) {
							this.callStatus = this.CallStatus.CONFIRMED;
							this.callStatusExternal = CallStatus.CONNECTED;
						}
						else{
							console.warn('call FAILED');
							if(this.callDirection === this.CallDirection.INCOMING) {
								this.reject();
								// notify app
								this.errorCallback('call failed');
							}
						}
						break;
					case this.CallStatus.CALLING:
					case this.CallStatus.CANCELED:
						break;
					default:
					   console.warn('Call.onStableStatus() Dazed and confused in state ' + this.callStatus + ', stopping here');
					   break;
				  }
			 }
		};


		/**
		 * @summary Function called when RTCPeerConnection onaddstream event is fired.
		 * @param {MediaStreamEvent} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnAddStream = function (evt) {
			console.debug("Call.onRTCPeerConnectionOnAddStream()");
			var managedSteam , event;
			managedSteam = orca.createManagedStream(evt.stream);

			evt.stream.onaddtrack = function (track) {
			    console.log('onaddtrack ', evt.stream.getVideoTracks());
			    var managedSteam , event;
			    managedSteam = orca.createManagedStream(evt.stream);

			    self.managedStreams.push(managedSteam);
			    event = {name:CallStatus.ADDSTREAM};
			    //self.callback.onAddStream(managedSteam, event); console.log("self.callback.onAddStream(managedSteam, event) callback") ;
			  }; 


			self.managedStreams.push(managedSteam);
			this.callStatusExternal = CallStatus.ADDSTREAM;
			event = {name:CallStatus.ADDSTREAM};
			self.callback.onAddStream(managedSteam, event);
		};

		/**
		 * @summary Function called when RTCPeerConnection onconnecting event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnConnecting = function (evt) {
			console.debug("Call.onRTCPeerConnectionConnecting()");
		};

		/**
		 *  Callback for ongatheringchange RTCPeerConnection event.
		 * @param {Event} evt
		 */
		this.onRTCPeerConnectionOnGatheringChange = function (evt) {
			console.debug("onRTCPeerConnectionOnGatheringChange()");
			if (evt.currentTarget !== undefined) {
				console.debug("onRTCPeerConnectionOnGatheringChange() evt.currentTarget.iceGatheringState = " + evt.currentTarget.iceGatheringState);
				if (evt.currentTarget.iceGatheringState === "complete") {
					if ((self.callStatus === self.CallStatus.PREPARING_OFFER) || (self.callStatus === self.CallStatus.PREPARING_ANSWER)) {
						self.waitingIce = false;
						self.markActionNeeded();
					} else {
						console.debug("onRTCPeerConnectionOnGatheringChange() Event reveived event is dropped");
					}
				}
			}
		};

		/**
		 * @summary Function called when RTCPeerConnection onicecandidate event is fired.
		 * @param {RTCPeerConnectionIceEvent} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnIceCandidate = function (evt) {
			var cc;
			if (evt.candidate === null) {
				console.debug("Call.onRTCPeerConnectionIceCandidate() end of candidates [status = " + self.callStatus + ", callDirection = " + self.callDirection + ", activeCall = " + self.activeCall + "]");
				if ((self.callStatus === self.CallStatus.PREPARING_OFFER || self.callStatus === self.CallStatus.PREPARING_ANSWER)
						&& (!self.session.config.providerConfig.useFirstCandidate || !self.gotFirstCandidate)) {
					self.gotFirstCandidate = true;
					self.waitingIce = false;
					self.markActionNeeded();
				} else {
					console.debug("Call.onRTCPeerConnectionOnIceCandidate() RTCPeerConnectionIceEvent received event is dropped");
				}
			} else {
				console.debug("Call.onRTCPeerConnectionIceCandidate() received candidate = " +
					evt.candidate.candidate + " [status = " + self.callStatus +
					", callDirection = " + self.callDirection +
					", activeCall = " + self.activeCall + "]");

				if (self.session.config.providerConfig.useFirstCandidate && !self.gotFirstCandidate
						&& (self.callStatus === self.CallStatus.PREPARING_OFFER || self.callStatus === self.CallStatus.PREPARING_ANSWER)) {
					if (self.session.config.providerConfig.removeIPV6Candidates) {
						cc = evt.candidate.candidate.split(' ');
						if (cc[4] && cc[4].indexOf(':') < 0) {
							self.gotFirstCandidate = true;
							self.waitingIce = false;
							self.markActionNeeded();
						}
					} else {
						self.gotFirstCandidate = true;
						self.waitingIce = false;
						self.markActionNeeded();
					}
				}
			}
		};

		/**
		 * @summary Function called when RTCPeerConnection onnegotiatoinneeded event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnNegotiationNeeded = function (evt) {
			console.debug("Call.onRTCPeerConnectionNegotiationNeeded()");
		};

		/**
		 * @summary Function called when RTCPeerConnection onopen event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnOpen = function (evt) {
			console.debug("Call.onRTCPeerConnectionOnOpen()");
		};

		/**
		 * @summary Function called when RTCPeerConnection onremovestream event is fired.
		 * @param {MediaStreamEvent} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnRemoveStream = function (evt) {
			console.debug("Call.onRTCPeerConnectionRemoveStream()");
		};

		/**
		 * @summary Function called when RTCPeerConnection onstatechange event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onRTCPeerConnectionOnStatusChange = function (evt) {
			console.debug("Call.onRTCPeerConnectionStatusChange() [readyStatus=" + evt.currentTarget.readyStatus + ', iceStatus=' + evt.currentTarget.iceStatus + "]");
		};

		/**
		 * @summary Function called when RTCPeerConnection DataChannel onopen event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onDataChannelOnOpen = function (evt) {
			console.debug("Call.onDataChannelOnOpen()");
		};

		/**
		 * @summary Function called when RTCPeerConnection DataChannel onopen event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onDataChannelOnClose = function (evt) {
			console.debug("Call.onDataChannelOnClose()");
		};

		/**
		 * @summary Function called when RTCPeerConnection DataChannel onmessage event is fired.
		 * @param {Event} evt
		 * @private
		 */
		this.onDataChannelOnMessage = function (evt) {
			//Raju
			if(evt.data instanceof File) {
				console.debug("evt.data  is File") ;
			} else if(evt.data instanceof Blob) {
				console.debug("evt.data  is Blob") ;
			} else if(evt.data instanceof ArrayBuffer) {
				console.debug("evt.data  is ArrayBuffer") ;
				//} else if(evt.data instanceof ArrayBufferView) {
				//	console.debug("evt.data  is ArrayBufferView") ;
			} else if(evt.data instanceof String) {
				console.debug("evt.data  is String") ;
			} else if(typeof evt.data === 'string') {
				console.debug("evt.data  is string") ;
			} else {
				console.debug("evt.data  is other : ") ;
			}

			console.debug("Call.onDataChannelOnMessage() message(length: "+ evt.data.length +"): " + evt.data);
			//var event = {message:evt.data};
			//Raju
			if(evt.data instanceof String || typeof evt.data === 'string') {
				console.log("Received data chan message is String.. doing callback directly") ;
				self.callback.onMessage(evt.data);
			} else {

				console.log("Received data chan message is NOT string .. converting it to binary string") ;
				function readBinaryStringFromArrayBuffer (arrayBuffer,onSuccess,  onerror)
				{
					var reader = new FileReader();
					reader.onload = function (event) {
						onSuccess(event.target.result);
					};
					reader.onerror = function (event) {
						onFail(event.target.error);
					};
					//reader.readAsText(new Blob([ arrayBuffer ],
					reader.readAsBinaryString(new Blob([ arrayBuffer ],
								{ type: 'application/octet-stream' }));
				}

				readBinaryStringFromArrayBuffer(evt.data, 
					function(str) {	
					 	console.log("converted binary string (length: " + str.length + "), type '" + typeof str + "' " + str) ;
						self.callback.onMessage(str);
					} , 
					function(error) {console.error("converting to binary string failed" + error) ;})
			}
			//self.callback.onMessage(evt.data);

		};

		this.createOfferSuccess = function (sdp) {
			console.log("createOffer worked with new constraint style") ;
			console.debug("unmodified local SDP from createOffer:\n" + sdp.sdp) ;
			sdpOffer = self.updateSDPOfferMediaDirection( sdp, {audio:self.audioMediaDirection, video:self.videoMediaDirection});
			sdpOffer = self.updateSDPForTempWorkarounds( sdpOffer, 'offer');
			sdpOffer = self.updateSDPCrypto( sdpOffer, 'offer');
			sdpOffer = self.updateSDPssrc( sdpOffer, 'offer');
			sdpOffer = self.updateSDPcodecs( sdpOffer, 'offer', 'audio',
						self.session.config.providerConfig.audioCodecs);
			sdpOffer = self.updateSDPcodecs( sdpOffer, 'offer', 'video',
						self.session.config.providerConfig.videoCodecs);
			sdpOffer = self.updateSDPOfferMediaBundle( sdpOffer, 'offer');
			sdpOffer = self.updateSDPBandwidth(sdpOffer, 'offer');

			if ( self.bodilessReInvite )
			{
				console.log( "Making offer after Offerless Invite received.");
				self.bodilessReInvite = false;
			}

			/*
			 *  We encountered a Chrome issue during a 'Resume' operation after a HOLD.
			 *  The problem was only experienced at the called party side and was due to
			 *  an issue in Chrome where Chrome would change the video stream's 
			 *  Local ICE credentials (ice-ufrag and ice-pwd) when the called party made use of 
			 *  createOffer after a prior call to createAnswer.
			 *  This resulted in Chrome generating different Local ICE credentials for video
			 *  than were in use prior to the HOLD.  This resulted in no video at the
			 *  calling party side after the 'Resume'.
			 *  
			 *  In order to workaround this issue, we will try to use the same Local video
			 *  ICE credentials that were in use before.  We will save the Local ICE credentials
			 *  when createAnswer is called and we will use the same Local ICE credentials
			 *  after createOffer is called if createOffer changed the ICE credentials.
			 *  
			 *  The logic assumes Chrome uses new ice credentials for video only. 
			 *  If Chrome’s behavior changes to alter ice credentials for audio in 
			 *  general (even with just one m=audio line) or due to SDP having m=video first 
			 *  followed by audio, then this fix won’t work.
			 *  If these assumptions change then we may have to change the code to 
			 *  monitor each m= line independently for ice changes which may insure us against 
			 *  possible future br*.ppteakages from Chrome (or FF or IE/Safari plugin).
			 *  
			 *  For upgrade/downgrade (or vice-versa and other similar video removal/add), 
			 *  the saved video ice credentials are not unset (explicitly to “”) 
			 *  during video removal, this means that during later revival of video m= line,
			 *  we will use the saved value even though it is ok to use the browser provided 
			 *  new ice credentials.
			 *  
			 *  We are not providing a config flag for this since we can add it later as 
			 *  needed (for example if a browser insists on a client changing 
			 *  ice credentials and fails setLD).
			 */
			if (   ( self.videoIceUfrag != '' )
			    && ( self.videoIcePwd != '' ) )
			{
				var offerVideoIceUfrag = self.getSDPattrValue( sdpOffer.sdp, 'video', 'ice-ufrag:');
				var offerVideoIcePwd = self.getSDPattrValue( sdpOffer.sdp, 'video', 'ice-pwd:');

				if (   ( offerVideoIceUfrag != '' )
				    && ( offerVideoIcePwd != '' )
				    && ( self.videoIceUfrag != offerVideoIceUfrag )
				    && ( self.videoIcePwd != offerVideoIcePwd ) )
				{
					console.log( "sdpOffer.sdp Before ICE params replaced = \n" + sdpOffer.sdp + "\n\n");
					sdpOffer.sdp = self.replaceSDPattr( sdpOffer.sdp, 'video', 'ice-ufrag:', self.videoIceUfrag);
					sdpOffer.sdp = self.replaceSDPattr( sdpOffer.sdp, 'video', 'ice-pwd:', self.videoIcePwd);
					console.log( "sdpOffer.sdp After ICE params replaced = \n" + sdpOffer.sdp + "\n\n");
				}
			}

			if (sdpOffer.sdp !== self.sdpOffer) {
				console.debug('createOffer: ' + self.oldMediaTypes + ',' + self.mediaTypes);

				//audio,video-->audio
				if ((self.oldMediaTypes && self.oldMediaTypes.indexOf('video') !== -1) && (self.mediaTypes.indexOf('video') === -1)) {
					//downgrading. sdp should have no a=ssrc for video
					var temp = sdpOffer.sdp.indexOf('m=video');
					if (temp !== -1) {
						console.debug("local SDP has m=video line but video is not needed now... adding m=video 0 line and removing existing m=video line") ;
						//TODO: m=video line could be first (Firefox could do it that way and it is legal).
						// in such a case this code will not work.
						// rewrite this code to replace 'm=video <port>\r\n' line with 'm=video RTP/SAVPF 0'
						sdpOffer.sdp = sdpOffer.sdp.substring(0, temp);
					}
					sdpOffer.sdp += 'm=video 0 RTP/SAVPF 0\nc=IN IP4 0.0.0.0\n';
				}
				//audio-->audio
				if (self.oldMediaTypes && self.oldMediaTypes.indexOf('video') === -1 && (self.holdPending||self.resumePending) 
						&& (self.mediaTypes.indexOf('video') === -1)) {
					//downgrading. sdp should have no a=ssrc for video
					var temp = sdpOffer.sdp.indexOf('m=video');
					if (temp !== -1) {//downgrading audio-->audio, hold
						console.debug("local SDP has m=video line but video is not needed now... removing existing m=video line") ;
						sdpOffer.sdp = sdpOffer.sdp.substring(0, temp);
						sdpOffer.sdp += 'm=video 0 RTP/SAVPF 0\nc=IN IP4 0.0.0.0\n';
					} else {//call audio-->audio,hold/resume
						console.debug("local SDP has not m=video line") ;
					}
				}
				self.determineWaitingIce(sdpOffer);

				if (  self.restoredCall )
				{
					/*
					 *  We are about to send out an invite for purposes of
					 *  restoring a call after a temporary network loss.
					 *  We'll want the payloadTypes in this offer to match
					 *  the payloadTypes that were in use for the call we are
					 *  attempting to restore.
					 */
					sdpOffer = self.updateSDPForCallRecovery( sdpOffer, 'offer');
				}

				console.trace("createSDPOffer() setLocalDescription sdp = " + sdpOffer.sdp);
				self.pc.setLocalDescription( sdpOffer,
					self.setLDsuccessOnCreateOfferSuccess,
					self.setLDfailure);
				return;
			}
			console.debug('createSDPOffer() Not sending a new offer');
		};

		this.createOfferFailure = function( error) {
			console.error('createOffer failure: ' + error);
			self.errorCallback( error);
		};

		/**
		 * @summary Creates the SDP offer.
		 * @return {string} SDP offer
		 * @private
		 */
		this.createSDPOffer = function () {
			console.debug("Call.createSDPOffer()");

			if ( this.pc === null || this.restoredCall )
                        {
                                console.log( "Creating new peer connection" );

				if ( this.pc )
                                {
					// Save local streams and close current peer connection
					// prior to opening a new peer connection
                                        pc_streams = this.pc.getLocalStreams();
                                        this.pc.close();
                                        this.pc = null;
                                }

                                this.createPeerConnection();

                                if (  this.restoredCall )
                                {
					// add stream to new peer connection
                                        this.pc.addStream( pc_streams[0] );
                                }

                        }

			var constraint, constraint1, constraint2, audio=false, video=false, sdpOffer;

			if (this.mediaTypes.indexOf('audio') !== -1) {
				audio=true;
			}

			if (this.mediaTypes.indexOf('video') !== -1) {
				video=true;
			}

			constraint1 = { audio: audio, video: video };
			constraint2 = {'mandatory': {'OfferToReceiveAudio':audio, 'OfferToReceiveVideo':video}};

			console.debug("createSDPOffer(): oldMediaTypes=" + this.oldMediaTypes + "; current mediaTypes=" + this.mediaTypes);

			// if ((this.mediaTypes === undefined) && (callParams.callDirection === "incoming")) {
				// this.mediaTypes = "audiovideo";
				// if (!callParams.videoMediaDirection) {
					// callParams.videoMediaDirection = "sendrecv";
				// }
				// if (!callParams.audioMediaDirection) {
					// callParams.audioMediaDirection = "sendrecv";
				// }
				// this.videoMediaDirection = this.MediaDirection.SENDRECV;
				// this.audioMediaDirection = this.MediaDirection.SENDRECV;
			// }

			if (this.holdPending === false && this.resumePending === false) {    
				if (this.mediaTypes.indexOf('audio') !== -1) {
						this.audioMediaDirection = this.MediaDirection.SENDRECV;
				}
				if (this.mediaTypes.indexOf('video') !== -1) {
					this.videoMediaDirection = this.MediaDirection.SENDRECV;
				}
			}

			try {
				this.pc.createOffer( this.createOfferSuccess, this.createOfferFailure, constraint1);
			} catch (e1) {
				try {
					this.pc.createOffer( this.createOfferSuccess, this.createOfferFailure, constraint2);
				} catch (e2) {
					console.error('Call.createSDPOffer() webkitRTCPeerConnection can not create a SDP offer, exception = ' + e2);
				}
			}
		};

 		/**
		 * @summary Update SDP to ensure that IP and port match a UDP candidate.
		 * @param {string} sdpoffer SDP
		 * @param {string} sdpType 'offer' or 'answer'
		 * @private
		 */
		this.updateSDPCandidate = function (sdpoffer, sdpType) {
			console.debug('updateSDPCandidate()');
			var sdp, m, i, j, ipv, server, port, candidates, cc, matched, sessionServer, isSessionServer, changed = false,
				re1 = /^(audio|video|application) ([0-9]+)([^\r\n]*)/,
				re2 = /(\r\nc=[^\s]* )([^\s]*) ([^\s]*)/,
				re3 = /\r\na=candidate:[^\s]* [^\s]* UDP [^\s]* ([^\s]*) ([^\s]*)/gi,
				re4 = /\r\na=candidate:[^\r\n]*/g,
				re5 = /(\r\na=rtcp:)([^\s]*) ([^\s]*) ([^\s]*) ([^\s]*)/;
			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdp = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdp = sdpoffer.toSdp();
			} else {
				sdp = sdpoffer;
			}
			m = sdp.split('\r\nm=');
			sessionServer = m[0].match(re2);
			for (i = 1; i < m.length; i += 1) {
				if (this.session.config.providerConfig.removeIPV6Candidates) {
					// Remove IPV6 candidates
					candidates = m[i].match(re4);
					if (candidates) {
						for (j = 0; j < candidates.length; j += 1) {
							cc = candidates[j].split(' ');
							if (cc[4] && cc[4].indexOf(':') > -1) {
								m[i] = m[i].replace(candidates[j], '');
								changed = true;
							}
						}
						if (changed) {
							server = re5.exec(m[i]);
							candidates = m[i].match(re3);
							if (server && server[5].indexOf(':') > -1 && candidates && candidates[1]) {
								//change rtcp attribute to match second UDP candidate
								candidates = re3.exec(candidates[1]);
								m[i] = m[i].replace(re5, '$1' + candidates[2] + ' $3 IP4 ' + candidates[1]);
							}
						}
					}
				}
				// Ensure that IP and port match a UDP candidate
				port = m[i].match(re1);
				if (port) {
					port = port[2];
					server = m[i].match(re2);
					if (server) {
						server = server[3];
						isSessionServer = false;
					} else if (sessionServer) {
						server = sessionServer[3];
						isSessionServer = true;
					}
					if (server) {
						matched = false;
						candidates = m[i].match(re3);
						if (candidates) { //check if c and m lines match any UDP candidate
							for (j = 0; j < candidates.length; j += 1) {
								cc = candidates[j].split(' ');
								if (server === cc[4] && port === cc[5]) {
									matched = true;
									break;
								}
							}
						}
						if (!matched) { //change c and m lines to match first UDP candidate
							cc = re3.exec(m[i]);
							if (cc) {
								server = cc[1];
								port = cc[2];
								ipv = (cc[1].indexOf(':') > -1) ? 'IP6' : 'IP4';
								if (isSessionServer) {
									m[i] = m[i].replace(re1, '$1 ' + port + '$3'
											+ (server === sessionServer[3] ? ''
											: sessionServer[0].replace(re2, '$1' + ipv + ' ' + server)));
								} else {
									m[i] = m[i].replace(re1, '$1 ' + port + '$3').replace(re2, '$1' + ipv + ' ' + server);
								}
								changed = true;
							}
						}
					}
				}
			}
			if (changed) {
				sdp = m.join('\r\nm=');
				console.debug("updateSDPCandidate() SDP has been updated:" + sdp);
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:sdpType, sdp:sdp});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription(sdp);
				}
				return sdp;
			}
			console.debug("updateSDPCandidate() SDP has not been updated");
			return sdpoffer;
		};

		/**
		 * @summary Updates a SDP.
		 * @param {string} sdp SDP
		 * @param {object} medias constraints on the media
		 * @private
		 */
		this.updateSDPOfferMediaDirection = function (sdpoffer, medias) {
			var sdp, sdpstr1, sdpstr2, idx, changed;

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdp = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdp = sdpoffer.toSdp();
			} else {
				sdp = sdpoffer;
			}

			sdpstr1 = sdp;
			idx = -1;
			changed = false;

			if (medias.audio !== undefined) {
				idx = sdp.indexOf("a=sendrecv");
				if (idx === -1) {
					idx = sdp.indexOf("a=sendonly");
					if (idx === -1) {
						idx = sdp.indexOf("a=recvonly");
						if (idx === -1) {
							idx = sdp.indexOf("a=inactive");
						}
					}
				}

				if (idx !== -1) {
					sdpstr1 = sdp.substring(0, idx);
					sdpstr1 = sdpstr1 + "a=" + medias.audio;
					sdpstr1 = sdpstr1 + sdp.substring(idx+10);
					changed = true;
				}
			}

			if (medias.video !== undefined) {
				idx = sdp.lastIndexOf("a=sendrecv");
				if (idx === -1) {
					idx = sdp.lastIndexOf("a=sendonly");
					if (idx === -1) {
						idx = sdp.lastIndexOf("a=recvonly");
						if (idx === -1) {
							idx = sdp.indexOf("a=inactive");
						}
					}
				}

				if (idx !== -1) {
					sdpstr2 = sdpstr1.substring(0, idx);
					sdpstr2 = sdpstr2 + "a=" + medias.video;
					sdpstr2 = sdpstr2 + sdpstr1.substring(idx+10);
					changed = true;
				}

			} else {
				sdpstr2 = sdpstr1;
			}

			if (changed === true) {
				//console.debug("Call.updateSDPOfferMediaDirection() medias = " + medias, ", SDP has been updated:= " + sdpstr2);
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:'offer', sdp:sdpstr2});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription(sdpstr2);
				}
				return sdpstr2;
			}
			console.debug("Call.updateSDPOfferMediaDirection() medias = " + medias, ", SDP has not been updated)");
			return sdpoffer;
		};

		/**
		 * @summary Updates a SDP.
		 * @param {string} sdp SDP
		 * @param {string} sdpType 'offer' or 'answer'
		 * @private
		 */
		this.updateSDPOfferMediaBundle = function (sdpoffer, sdpType) {
			var sdp, changed, idx;

			if ( self.session.config.providerConfig.bundle == true )
			{
				console.debug("updateSDPOfferMediaBundle() no change, bundle is true.\n") ;
				return sdpoffer;
			}
			else
			{
				console.debug("updateSDPOfferMediaBundle() entry.\n");
			}

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdp = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdp = sdpoffer.toSdp();
			} else {
				sdp = sdpoffer;
			}

			changed = false;

			idx = sdp.indexOf("a=group:BUNDLE audio video");
			if (idx !== -1) {
				changed = true;
				sdp = sdp.replace("a=group:BUNDLE audio video\r\n", "");
			} else {
				idx = sdp.indexOf("a=group:BUNDLE audio");
				if (idx !== -1) {
					changed = true;
					sdp = sdp.replace("a=group:BUNDLE audio\r\n", "");
				} else {
					idx = sdp.indexOf("a=group:BUNDLE video");
					if (idx !== -1) {
						changed = true;
						sdp = sdp.replace("a=group:BUNDLE video\r\n", "");
					}
				}
			}

			if (changed === true) {
				//console.debug("updateSDPOfferMediaBundle() SDP has been updated:" + sdp);
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:sdpType, sdp:sdp});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription(sdp);
				}
				return sdp;
			}
			console.debug("updateSDPOfferMediaBundle() SDP has not been updated)");
			return sdpoffer;
		};

		/**
		 * @summary Updates a SDP.
		 * @param {string} sdp SDP
		 * @param {string} sdpType 'offer' or 'answer'
		 * @private
		 */
		this.updateSDPCrypto = function (sdpoffer, sdpType) {
			console.debug('updateSDPCrypto()');
			var sdp, changed, idx;
			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdp = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdp = sdpoffer.toSdp();
			} else {
				sdp = sdpoffer;
			}

			changed = false;
			if(this.session.config.providerConfig.crypto.toLowerCase() !== "dtls-srtp") {
				idx = sdp.indexOf("a=crypto:0 ");
				if (idx !== -1) {
					changed = true;
					if(sdp.indexOf('a=crypto:1') === -1)
						sdp = sdp.replace(/a=crypto:0/g, "a=crypto:1");
					else //this can be removed as it won't hurt when testing with chrome 30.
						sdp = sdp.replace(/a=crypto:0.*\r\n/g, "");
				}
				// Chrome 31 throws SetLocalDescription failed: Called with type in wrong state, type: offer state: STATE_RECEIVEDINITIATE
				// if removing fingerprint attribute before setLocalDescription for incoming INVITEs.
				if ( sdpType === "offer" ) {
					sdp = sdp.replace(/a=fingerprint.*\r\n/g, "");
					sdp = sdp.replace(/a=setup:actpass\r\n/g, "");
					changed = true;
				}
			}

			// if(this.crypto !== null && (sdp.indexOf('a=crypto') > sdp.indexOf('m=video '))) {
			// 	//sdp = sdp.replace(/a=crypto:1 .*/, this.crypto[0]);
			// 	//this.crypto = sdp.match(/(a=crypto:1 .*)/g);
			// 	sdp = sdp.replace(/a=rtpmap:/, this.crypto[0]+'\r\na=rtpmap:');
			// 	changed = true;
			// }
			// else{
			// 	this.crypto = sdp.match(/(a=crypto:1 .*)/g);
			// }

			if (changed === true) {
				//console.debug("updateSDPCrypto() SDP has been updated:" + sdp);
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:sdpType, sdp:sdp});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription(sdp);
				}
				return sdp;
			}
			console.debug("updateSDPCrypto() SDP has not been updated)");
			return sdpoffer;
		};

		/**
		 * @summary Updates a SDP to strip unwanted ssrc
		 * @param {string} sdpoffer SDP
		 * @param {string} sdpType  'offer' or 'answer'
		 * @private
		 */
		this.updateSDPssrc = function( sdpoffer, sdpType)
		{
			var	i;
			var 	sdpstr;
			var	changed = false;

                        if ( self.session.config.providerConfig.stripExtraSSRC == false )
                        {
				console.debug("updateSDPssrc() no change, stripExtraSSRC is false.\n") ;
				return sdpoffer;
                        }
			else
			{
				console.debug("updateSDPssrc() entry.\n") ;
			}

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdpstr = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdpstr = sdpoffer.toSdp();
			} else {
				sdpstr = sdpoffer;
			}

/*
 *   Sample:
 *   unmodified local SDP from createOffer:
 *   ---------------------------------------
 *   v=0
 *   o=- 3202744234815283812 2 IN IP4 127.0.0.1
 *   s=-
 *   t=0 0
 *   a=group:BUNDLE audio video
 *   a=msid-semantic: WMS 93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If
 *   m=audio 1 RTP/SAVPF 111 103 104 0 8 106 105 13 126
 *   c=IN IP4 0.0.0.0
 *   a=rtcp:1 IN IP4 0.0.0.0
 *   a=ice-ufrag:r8+nG5cPhyEUJWT7
 *   a=ice-pwd:lIptuXyHoT8j9R86BGUpYCKA
 *   a=ice-options:google-ice
 *   a=fingerprint:sha-256 75:94:B5:63:39:74:00:B9:F1:BF:85:66:08:B3:42:15:3C:99:62:DA:DF:17:EB:A7:9F:AD:F1:C8:97:FA:DD:F2
 *   a=setup:actpass
 *   a=mid:audio
 *   a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
 *   a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 *   a=sendrecv
 *   a=rtcp-mux
 *   a=rtpmap:111 opus/48000/2
 *   a=fmtp:111 minptime=10
 *   a=rtpmap:103 ISAC/16000
 *   a=rtpmap:104 ISAC/32000
 *   a=rtpmap:0 PCMU/8000
 *   a=rtpmap:8 PCMA/8000
 *   a=rtpmap:106 CN/32000
 *   a=rtpmap:105 CN/16000
 *   a=rtpmap:13 CN/8000
 *   a=rtpmap:126 telephone-event/8000
 *   a=maxptime:60
 *   a=ssrc:4226931872 cname:fhauWmX5/xn7AHdL
 *   a=ssrc:4226931872 msid:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If cafc95b2-6efe-4c77-8ad1-ea0ebbbd5100
 *   a=ssrc:4226931872 mslabel:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If
 *   a=ssrc:4226931872 label:cafc95b2-6efe-4c77-8ad1-ea0ebbbd5100
 *   	// Note that the second audio ssrc is the one Chrome uses for OPUS
 *   	// so we will strip the first.  We will also strip the ssrc-group attribute
 *   	// and also strip the rtx codec and 'apt=' payloadType formatting attribute if present
 *   a=ssrc:925829225 cname:P/2lxWPYS5d0Z4Gd
 *   a=ssrc:925829225 msid:tgrwgEagiphRpR9gicuvVykn9g8Sty9sny3b 661ca6e3-0ce5-45c0-881a-ebef5e0ee084
 *   a=ssrc:925829225 mslabel:tgrwgEagiphRpR9gicuvVykn9g8Sty9sny3b
 *   a=ssrc:925829225 label:661ca6e3-0ce5-45c0-881a-ebef5e0ee084
 *   m=video 1 RTP/SAVPF 100 116 117 96
 *   c=IN IP4 0.0.0.0
 *   a=rtcp:1 IN IP4 0.0.0.0
 *   a=ice-ufrag:r8+nG5cPhyEUJWT7
 *   a=ice-pwd:lIptuXyHoT8j9R86BGUpYCKA
 *   a=ice-options:google-ice
 *   a=fingerprint:sha-256 75:94:B5:63:39:74:00:B9:F1:BF:85:66:08:B3:42:15:3C:99:62:DA:DF:17:EB:A7:9F:AD:F1:C8:97:FA:DD:F2
 *   a=setup:actpass
 *   a=mid:video
 *   a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
 *   a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 *   a=sendrecv
 *   a=rtcp-mux
 *   a=rtpmap:100 VP8/90000
 *   a=rtcp-fb:100 ccm fir
 *   a=rtcp-fb:100 nack
 *   a=rtcp-fb:100 nack pli
 *   a=rtcp-fb:100 goog-remb
 *   a=rtpmap:116 red/90000
 *   a=rtpmap:117 ulpfec/90000
 *   a=rtpmap:96 rtx/90000
 *   a=fmtp:96 apt=100
 *   a=ssrc-group:FID 4289949195 3660713198
 *   a=ssrc:4289949195 cname:fhauWmX5/xn7AHdL
 *   a=ssrc:4289949195 msid:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If f35d1d93-eafd-4296-9870-1646c2d30398
 *   a=ssrc:4289949195 mslabel:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If
 *   a=ssrc:4289949195 label:f35d1d93-eafd-4296-9870-1646c2d30398
 *   a=ssrc:3660713198 cname:fhauWmX5/xn7AHdL
 *   a=ssrc:3660713198 msid:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If f35d1d93-eafd-4296-9870-1646c2d30398
 *   a=ssrc:3660713198 mslabel:93K5z0UQA2RCF01HGx9Ae9tpFU2K9ciZl6If
 *   a=ssrc:3660713198 label:f35d1d93-eafd-4296-9870-1646c2d30398
 */
 			/*
			 *  Handle the removal of the extra and unnecessary ssrc lines for video.
			 */
			if (   ( sdpstr.search("m=video") != -1 )
			    && ( sdpstr.search("a=ssrc-group:FID") != -1) )
			{
				// Assumption: when above conditions match,
				//    There are 2 sets of ssrcs present for video
				//    and they are listed at the end.
				// NOTE: Firefox does not have ssrc-group, so the above conditions won't match
				console.debug("Removing a=fmtp:96 apt=100, a=ssrc-group and 1st set of ssrc for video\n") ;
				sdpstr = sdpstr.replace("a=rtpmap:96 rtx/90000\r\na=fmtp:96 apt=100\r\n", "");
				sdpstr = sdpstr.replace("100 116 117 96\r\n", "100 116 117\r\n");
				// Remove ssrc-group
				sdpstr = sdpstr.replace(/a=ssrc-group:FID.*\r\n/, "");

				// Remove 1st ssrc group in the list
				// Chrome puts main ssrc as the 2nd ssrc. retransmission as the 1st one! :-(
				sdpstr = this.removeSDPattr( sdpstr, 'video', 'ssrc:', 1, 4);

				// Remove 2nd ssrc
				/*
				sdpstr = this.removeSDPattr( sdpstr, 'video', 'ssrc:', 5, 4);
				*/

				changed = true ; 
			}

			/* For call hold scenario Chrome adds just a=rtpmap:96 rtx/90000^M a=fmtp:96 apt=100
			 * back but without a=ssrc-group:FID, so the above code won't delete these.
			 * Delete the rtx and apt lines.
			 */
			if ( ( sdpstr.search("m=video") != -1 ) &&
			     ( sdpstr.search("a=rtpmap:96 rtx/90000") != -1) ) 
			{
				console.debug("rtx found. Removing a=fmtp:96 apt=100\n") ;
				sdpstr = sdpstr.replace("a=rtpmap:96 rtx/90000\r\na=fmtp:96 apt=100\r\n", "");
				sdpstr = sdpstr.replace("100 116 117 96\r\n", "100 116 117\r\n");
				changed = true ; 
			}

 			/*
			 *  Handle the removal of the extra and unnecessary ssrc lines for audio.
			 */
			sdpstr = sdpstr.split("\r\nm=");

			// Isolate the audio stream attributes
			for ( i = 0 ; i < sdpstr.length ; i++ )
			{
				if ( sdpstr[i].indexOf('audio') == 0 )
				{
					// Find and remove the extra and unwanted ssrc lines (all but the last set)
					var ssrcList = sdpstr[i].split("a=ssrc:");
					if ( ssrcList.length > 5 )
					{
						// We'll assume that cname, msid, mslabel and label ssrc properties are listed in each set
						ssrcList.splice( 1, ssrcList.length - 5);	// Remove all but the last set
						sdpstr[i] = ssrcList.join("a=ssrc:");
						changed = true;

						// We are not currently seeing rtx for audio so that piece is pending.
						// if Chrome happens to include rtx for audio, we'll remove that as well.
						// If this is implemented we would need to strip the ssrc-group line(s),
						//	strip the payloadType used for rtx along with any 
						//	associated rtpmap lines and payloadType formatting attributes (fmtp)
						// sdpstr[i] = sdpstr[i].replace(/a=ssrc-group:FID.*\r\n/, "");
					}

					break;
				}
			}
			// restore sdpstr
			sdpstr = sdpstr.join("\r\nm=");

			if (changed === true) {
				console.debug("updateSDPssrc(), SDP has been updated.");
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription( {type:sdpType, sdp:sdpstr});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription( sdpstr);
				}
				return sdpstr;
			}

			console.debug("updateSDPssrc(), SDP has not been updated.");
			return sdpoffer;
		};

		/**
		 * @summary Removes 1 or more instances of a stream attribute
		 * @param {string} sdpstr SDP
		 * @param {string} mediaType eg. 'audio' or 'video' or 'session'
		 * @param {string} attr	Attribute to be removed, eg. 'ssrc:' to remove a=ssrc:
		 * @param {number} startInstance Remove starting with the instance specified
		 * @param {number} count Remove this many attributes
		 * @returns {string} sdpstr Updated sdpstr
		 */
                this.removeSDPattr = function ( sdpstr, mediaType, attr, startInstance, count) {

			/*
			 *  removeSDPattr can used to remove attributes from a either
			 *  an audio stream or from a video stream or remove attributes that
			 *  are session level attributes.  It can also remove
			 *  a single instance of an attribute or multiple instances not necessarily
			 *  starting withthe first instance.
			 *  For example,
			 *  Given the following SDP in sdpstr (the line numbers are not part of the sdp content):
 * 01 	v=0
 * 02 	o=- 6578519815996902092 2 IN IP4 127.0.0.1
 * 03 	s=-
 * 04 	t=0 0
 * 05 	a=msid-semantic: WMS 7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 06 	m=audio 65157 RTP/SAVPF 111 9 0 8 105 13 126
 * 07 	c=IN IP4 135.244.25.225
 * 08 	a=rtcp:65159 IN IP4 135.244.25.225
 * 09 	a=candidate:3317792324 1 udp 2122063615 135.244.25.225 65157 typ host generation 0
 * 10 	a=candidate:1700189580 1 udp 2121998079 200.108.103.6 65158 typ host generation 0
 * 11 	a=candidate:3317792324 2 udp 2122063614 135.244.25.225 65159 typ host generation 0
 * 12 	a=candidate:1700189580 2 udp 2121998078 200.108.103.6 65160 typ host generation 0
 * 13 	a=candidate:2336391860 1 tcp 1518083839 135.244.25.225 0 typ host tcptype active generation 0
 * 14 	a=candidate:735390076 1 tcp 1518018303 200.108.103.6 0 typ host tcptype active generation 0
 * 15 	a=candidate:2336391860 2 tcp 1518083838 135.244.25.225 0 typ host tcptype active generation 0
 * 16 	a=candidate:735390076 2 tcp 1518018302 200.108.103.6 0 typ host tcptype active generation 0
 * 17 	a=ice-ufrag:PmJDtDzFt51DpZTa
 * 18 	a=ice-pwd:EnWB3Pp/2WU+X43I99M0oUlM
 * 19 	a=ice-options:google-ice
 * 20 	a=mid:audio
 * 21 	a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
 * 22 	a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 * 23 	a=sendrecv
 * 24 	a=rtcp-mux
 * 25 	a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:lsxZuNzVmkcooFc2RpXUk+IDpF1cCWiDf4xsqrbz
 * 26 	a=rtpmap:111 opus/48000/2
 * 27 	a=fmtp:111 minptime=10
 * 28 	a=rtpmap:105 CN/16000
 * 29 	a=rtpmap:126 telephone-event/8000
 * 30 	a=maxptime:60
 * 31 	a=ssrc:3707974342 cname:FkACGYTYDJ9/lOpx
 * 32 	a=ssrc:3707974342 msid:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k 686ece22-29b9-4016-bd15-156f7b427a70
 * 33 	a=ssrc:3707974342 mslabel:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 34 	a=ssrc:3707974342 label:686ece22-29b9-4016-bd15-156f7b427a70
 * 35 	m=video 65161 RTP/SAVPF 100 116 117
 * 36 	c=IN IP4 135.244.25.225
 * 37 	b=AS:256
 * 38 	a=rtcp:65163 IN IP4 135.244.25.225
 * 39 	a=candidate:3317792324 1 udp 2122063615 135.244.25.225 65161 typ host generation 0
 * 40 	a=candidate:1700189580 1 udp 2121998079 200.108.103.6 65162 typ host generation 0
 * 41 	a=candidate:3317792324 2 udp 2122063614 135.244.25.225 65163 typ host generation 0
 * 42 	a=candidate:1700189580 2 udp 2121998078 200.108.103.6 65164 typ host generation 0
 * 43 	a=candidate:2336391860 1 tcp 1518083839 135.244.25.225 0 typ host tcptype active generation 0
 * 44 	a=candidate:735390076 1 tcp 1518018303 200.108.103.6 0 typ host tcptype active generation 0
 * 45 	a=candidate:2336391860 2 tcp 1518083838 135.244.25.225 0 typ host tcptype active generation 0
 * 46 	a=candidate:735390076 2 tcp 1518018302 200.108.103.6 0 typ host tcptype active generation 0
 * 47 	a=ice-ufrag:PmJDtDzFt51DpZTa
 * 48 	a=ice-pwd:EnWB3Pp/2WU+X43I99M0oUlM
 * 49 	a=ice-options:google-ice
 * 50 	a=mid:video
 * 51 	a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
 * 52 	a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 * 53 	a=sendrecv
 * 54 	a=rtcp-mux
 * 55 	a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:lsxZuNzVmkcooFc2RpXUk+IDpF1cCWiDf4xsqrbz
 * 56 	a=rtpmap:100 VP8/90000
 * 57 	a=rtcp-fb:100 ccm fir
 * 58 	a=rtcp-fb:100 nack
 * 59 	a=rtcp-fb:100 nack pli
 * 60 	a=rtcp-fb:100 goog-remb
 * 61 	a=rtpmap:116 red/90000
 * 62 	a=rtpmap:117 ulpfec/90000
 * 63 	a=ssrc:2287471824 cname:FkACGYTYDJ9/lOpx
 * 64 	a=ssrc:2287471824 msid:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k bee230f5-7110-4054-9977-3fc8b15c0e46
 * 65 	a=ssrc:2287471824 mslabel:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 66 	a=ssrc:2287471824 label:bee230f5-7110-4054-9977-3fc8b15c0e46
 *
			 *  Issueing the following call:
                	 *	removeSDPattr( sdpstr, 'session', 'msid-semantic:', 1, 1);
			 *  would remove the following sdp lines: 05
			 * 
			 *  Issueing the following call:
                	 *	removeSDPattr( sdpstr, 'audio', 'rtcp-mux', 1, 1);
			 *  would remove the following sdp lines: 24 
			 * 
			 *  Issueing the following call:
                	 *	removeSDPattr( sdpstr, 'video', 'rtcp-mux', 1, 1);
			 *  would remove the following sdp lines: 54 
			 * 
			 *  Issueing the following call:
                	 *	removeSDPattr( sdpstr, 'video', 'candidate:', 5, 4);
			 *  would remove the following sdp lines: 43, 44, 45, 46
			 * 
			 */
                        var i, j, k, sdp;

                        if ( count <= 0 ) {
                                count = 1000;
                        }

			sdpstr = sdpstr.split("\r\nm=");

			/*
			 *  Set k such that sdpstr[k] holds the stream of interest.
			 *  If the attribute to be removed is a session level attribute then
			 *  k is 0 since sdpstr[0] holds the session level SDP
			 *  parameters and attributes.
			 */
			if ( mediaType == 'session' )
			{
				k = 0;
			}
			else
			{
				k = sdpstr.length;
				for ( i = 1 ; i < sdpstr.length ; ++i )
				{
					if ( sdpstr[i].indexOf( mediaType + ' ') == 0 )
					{
						k = i;
						break;
					}
				}
				if ( k == sdpstr.length )
				{
					console.debug("removeSDPattr() no " + mediaType + " stream found.\n");
					sdpstr = sdpstr.join("\r\nm=");
					return  sdpstr;
				}
			}

			sdp = sdpstr[k];
			sdp = sdp.split("\r\n");

                        for ( i = 0 ; i < sdp.length ; ++i )
                        {
                                if ( sdp[i].indexOf( "a=" + attr) == 0 )
                                {
					if ( startInstance > 1 )
					{
						--startInstance;
						continue;
					}

                                        sdp.splice( i, 1);
                                        /*
                                         *  One element was removed so decrement i
                                         *  so that the subsequent element, now at index i,
                                         *  may still be processed in the next for-loop iteration.
                                         */
                                        --i;
                                        --count;
                                        if ( count == 0 ) {
                                                break;
                                        }
                                }
                        }

			sdpstr[k] = sdp.join("\r\n");
			sdpstr = sdpstr.join("\r\nm=");

                        return sdpstr;
                };

		/**
		 * @summary Retrieves 1 or more instances of a stream attribute
		 * @param {string} sdpstr SDP
		 * @param {string} mediaType eg. 'audio' or 'video' or 'session'
		 * @param {string} attr	Attribute to be retrieved, eg. 'ssrc:' to get a=ssrc:
		 * @param {number} startInstance Retrieve starting with the instance specified
		 * @param {number} count Retrieve this many attributes
		 * @returns {Array} attrValues Array of attributes retrieved (CRCL not included)
		 */
                this.getSDPattrValues = function( sdpstr, mediaType, attr, startInstance, count) {

			/*
			 *  getSDPattrValues can used to retrieve attribute values from a either
			 *  an audio stream or from a video stream or retrieve attributes values 
			 *  from session level attributes.  It can also retrieve
			 *  a single instance of an attribute or multiple instances not necessarily
			 *  starting with the first instance.
			 *  For example,
			 *  Given the following SDP in sdpstr (the line numbers are not part of the sdp content):
 * 01 	v=0
 * 02 	o=- 6578519815996902092 2 IN IP4 127.0.0.1
 * 03 	s=-
 * 04 	t=0 0
 * 05 	a=msid-semantic: WMS 7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 06 	m=audio 65157 RTP/SAVPF 111 9 0 8 105 13 126
 * 07 	c=IN IP4 135.244.25.225
 * 08 	a=rtcp:65159 IN IP4 135.244.25.225
 * 09 	a=candidate:3317792324 1 udp 2122063615 135.244.25.225 65157 typ host generation 0
 * 10 	a=candidate:1700189580 1 udp 2121998079 200.108.103.6 65158 typ host generation 0
 * 11 	a=candidate:3317792324 2 udp 2122063614 135.244.25.225 65159 typ host generation 0
 * 12 	a=candidate:1700189580 2 udp 2121998078 200.108.103.6 65160 typ host generation 0
 * 13 	a=candidate:2336391860 1 tcp 1518083839 135.244.25.225 0 typ host tcptype active generation 0
 * 14 	a=candidate:735390076 1 tcp 1518018303 200.108.103.6 0 typ host tcptype active generation 0
 * 15 	a=candidate:2336391860 2 tcp 1518083838 135.244.25.225 0 typ host tcptype active generation 0
 * 16 	a=candidate:735390076 2 tcp 1518018302 200.108.103.6 0 typ host tcptype active generation 0
 * 17 	a=ice-ufrag:PmJDtDzFt51DpZTa
 * 18 	a=ice-pwd:EnWB3Pp/2WU+X43I99M0oUlM
 * 19 	a=ice-options:google-ice
 * 20 	a=mid:audio
 * 21 	a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level
 * 22 	a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 * 23 	a=sendrecv
 * 24 	a=rtcp-mux
 * 25 	a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:lsxZuNzVmkcooFc2RpXUk+IDpF1cCWiDf4xsqrbz
 * 26 	a=rtpmap:111 opus/48000/2
 * 27 	a=fmtp:111 minptime=10
 * 28 	a=rtpmap:105 CN/16000
 * 29 	a=rtpmap:126 telephone-event/8000
 * 30 	a=maxptime:60
 * 31 	a=ssrc:3707974342 cname:FkACGYTYDJ9/lOpx
 * 32 	a=ssrc:3707974342 msid:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k 686ece22-29b9-4016-bd15-156f7b427a70
 * 33 	a=ssrc:3707974342 mslabel:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 34 	a=ssrc:3707974342 label:686ece22-29b9-4016-bd15-156f7b427a70
 * 35 	m=video 65161 RTP/SAVPF 100 116 117
 * 36 	c=IN IP4 135.244.25.225
 * 37 	b=AS:256
 * 38 	a=rtcp:65163 IN IP4 135.244.25.225
 * 39 	a=candidate:3317792324 1 udp 2122063615 135.244.25.225 65161 typ host generation 0
 * 40 	a=candidate:1700189580 1 udp 2121998079 200.108.103.6 65162 typ host generation 0
 * 41 	a=candidate:3317792324 2 udp 2122063614 135.244.25.225 65163 typ host generation 0
 * 42 	a=candidate:1700189580 2 udp 2121998078 200.108.103.6 65164 typ host generation 0
 * 43 	a=candidate:2336391860 1 tcp 1518083839 135.244.25.225 0 typ host tcptype active generation 0
 * 44 	a=candidate:735390076 1 tcp 1518018303 200.108.103.6 0 typ host tcptype active generation 0
 * 45 	a=candidate:2336391860 2 tcp 1518083838 135.244.25.225 0 typ host tcptype active generation 0
 * 46 	a=candidate:735390076 2 tcp 1518018302 200.108.103.6 0 typ host tcptype active generation 0
 * 47 	a=ice-ufrag:PmJDtDzFt51DpZTa
 * 48 	a=ice-pwd:EnWB3Pp/2WU+X43I99M0oUlM
 * 49 	a=ice-options:google-ice
 * 50 	a=mid:video
 * 51 	a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
 * 52 	a=extmap:3 http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time
 * 53 	a=sendrecv
 * 54 	a=rtcp-mux
 * 55 	a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:lsxZuNzVmkcooFc2RpXUk+IDpF1cCWiDf4xsqrbz
 * 56 	a=rtpmap:100 VP8/90000
 * 57 	a=rtcp-fb:100 ccm fir
 * 58 	a=rtcp-fb:100 nack
 * 59 	a=rtcp-fb:100 nack pli
 * 60 	a=rtcp-fb:100 goog-remb
 * 61 	a=rtpmap:116 red/90000
 * 62 	a=rtpmap:117 ulpfec/90000
 * 63 	a=ssrc:2287471824 cname:FkACGYTYDJ9/lOpx
 * 64 	a=ssrc:2287471824 msid:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k bee230f5-7110-4054-9977-3fc8b15c0e46
 * 65 	a=ssrc:2287471824 mslabel:7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k
 * 66 	a=ssrc:2287471824 label:bee230f5-7110-4054-9977-3fc8b15c0e46
 *
			 *  Issueing the following call:
                	 *	getSDPattrValues( sdpstr, 'session', 'msid-semantic:', 1, 1);
			 *  would return the following attribute value:
			 *	' WMS 7s5K41R90lqjV7RAZaGPCE3vyf8CuDBPLU1k'
			 * 
			 *  Issueing the following call:
                	 *	getSDPattrValues( sdpstr, 'audio', 'ice-options:', 1, 1);
			 *  would return the following attribute value:
			 *	'google-ice'
			 * 
			 *  Issueing the following call:
                	 *	getSDPattrValues( sdpstr, 'video', 'ice-ufrag:', 1, 1);
			 *  would return the following attribute value:
			 *	'PmJDtDzFt51DpZTa'
			 */
                        var i, j, k, sdp;
			var attrVal;
			var attrValues = [];

                        if ( count <= 0 ) {
                                count = 1000;
                        }

			sdpstr = sdpstr.split("\r\nm=");

			/*
			 *  Set k such that sdpstr[k] holds the stream of interest.
			 *  If the attribute to be retrieved is a session level attribute then
			 *  k is 0 since sdpstr[0] holds the session level SDP
			 *  parameters and attributes.
			 */
			if ( mediaType == 'session' )
			{
				k = 0;
			}
			else
			{
				k = sdpstr.length;
				for ( i = 1 ; i < sdpstr.length ; ++i )
				{
					if ( sdpstr[i].indexOf( mediaType + ' ') == 0 )
					{
						k = i;
						break;
					}
				}
				if ( k == sdpstr.length )
				{
					console.debug("getSDPattrValues() no " + mediaType + " stream found.\n");
					sdpstr = sdpstr.join("\r\nm=");
					return  attrValues;
				}
			}

			sdp = sdpstr[k];
			sdp = sdp.split("\r\n");

                        for ( i = 0 ; i < sdp.length ; ++i )
                        {
                                if ( sdp[i].indexOf( "a=" + attr) == 0 )
                                {
					if ( startInstance > 1 )
					{
						--startInstance;
						continue;
					}

					/* This line has an attribute value to be retrieved. */
					attrVal = sdp[i].substr( sdp[i].indexOf(':')+1);
					attrValues.push( attrVal);
					
                                        --count;
                                        if ( count == 0 ) {
                                                break;
                                        }
                                }
                        }

			sdpstr[k] = sdp.join("\r\n");
			sdpstr = sdpstr.join("\r\nm=");

                        return attrValues;
                };

		/**
		 * @summary Retrieves the value of a stream attribute
		 * @param {string} sdpstr SDP
		 * @param {string} mediaType eg. 'audio' or 'video' or 'session'
		 * @param {string} attr	Attribute to be retrieved, eg. 'ice-pwd:' to get a=ice-pwd: value
		 * @returns {string} attrVal Value of attribute retrieved (CRCL not included)
		 */
                this.getSDPattrValue = function( sdpstr, mediaType, attr) {
                	var attrValues = this.getSDPattrValues( sdpstr, mediaType, attr, 1, 1);
			if ( attrValues.length != 0 ) {
				return attrValues[0];
			} else {
				return '';
			}
		};

		/**
		 * @summary Replaces the value of a stream attribute
		 * @param {string} sdpstr SDP
		 * @param {string} mediaType eg. 'audio' or 'video' or 'session'
		 * @param {string} attr	Attribute whose value is to be replaced
		 * @param {number} newValue The new value of the attribute.
		 */
                this.replaceSDPattr = function( sdpstr, mediaType, attr, newValue) {

                        var i, j, k, sdp;

			sdpstr = sdpstr.split("\r\nm=");

			/*
			 *  Set k such that sdpstr[k] holds the stream of interest.
			 *  If the attribute to be replaced is a session level attribute then
			 *  k is 0 since sdpstr[0] holds the session level SDP
			 *  parameters and attributes.
			 */
			if ( mediaType == 'session' )
			{
				k = 0;
			}
			else
			{
				k = sdpstr.length;
				for ( i = 1 ; i < sdpstr.length ; ++i )
				{
					if ( sdpstr[i].indexOf( mediaType + ' ') == 0 )
					{
						k = i;
						break;
					}
				}
				if ( k == sdpstr.length )
				{
					console.debug("replaceSDPattr() no " + mediaType + " stream found.\n");
					sdpstr = sdpstr.join("\r\nm=");
					return  sdpstr;
				}
			}

			sdp = sdpstr[k];
			sdp = sdp.split("\r\n");

                        for ( i = 0 ; i < sdp.length ; ++i )
                        {
                                if ( sdp[i].indexOf( "a=" + attr) == 0 )
                                {
					var newAttr = sdp[i].substring( 0, sdp[i].indexOf(':') + 1 );
					sdp[i] = newAttr + newValue;
                                }
                        }

			sdpstr[k] = sdp.join("\r\n");
			sdpstr = sdpstr.join("\r\nm=");

                        return sdpstr;
                };

		/**
		 * @summary Gets codecs and associated payloadTypes for stream of interest.
		 * @param {string} sdpstr SDP
		 * @param {string} mediaType 'audio' or 'video'
		 * @private
		 */
		this.getCodecsFromSDP = function( sdpstr, mediaType)
		{
			var	i, j, k;
			var	codecArray = [];
			var     eolPattern = new RegExp("\r\n$");

			console.debug("getCodecsFromSDP():" + "\n\tmediaType = " + mediaType + "\n");
			// console.debug("getCodecsFromSDP() sdp on entry:\n" + sdpstr) ;

			/*
			 *  Save codecs for stream of interest.
			 *  We may need these in an invite used to restore
			 *  a call after a network loss and a service continuity call recovery.
			 */
			sdpstr = sdpstr.split("\r\nm=");

			for ( i = 0 ; i < sdpstr.length ; i++ )
			{
				if ( sdpstr[i].indexOf( mediaType) == 0 )
				{
					/*
					 *  Walk the payloadTypes and save each
					 *  along with its associated codec.
					 */
					var lines = sdpstr[i].split("\r\n");
					var payloadTypes = lines[0].split(" ");

					/*
					 *  Skip past the media type, the portId and the transports
					 *  and walk the numeric payloadTypes.
					 */
					for ( j = 3 ; j < payloadTypes.length ; j++ )
					{
						//console.debug("PT(" + j + ") = " + payloadTypes[j] + "\n");
					
						// Verify we have a numeric payloadType
						if ( isNaN( payloadTypes[j]) == false )
						{
							var codecRateChan = '';
							var rtpmapLinePrefix = "a=rtpmap:" + payloadTypes[j] + " ";

							/*
							 *  Find the attribute line that holds the rtpmap
							 *  for this payloadType.
							 */
							for ( k = 0 ; k < lines.length ; ++k )
							{
								if ( lines[k].indexOf( rtpmapLinePrefix) == 0 )
								{
									break;
								}
							}

							/*  Get codecRateChan from rtpmap line */
							if ( k < lines.length )
							{
								codecRateChan = lines[k].substring( rtpmapLinePrefix.length);
								/* Remove "\r\n" if present at end of line */
								if ( eolPattern.test( codecRateChan) )
								{
									codecRateChan = codecRateChan.substr( 0, codecRateChan.length-2);
								}
							}
							else
							{
								codecRateChan = self.getCodecFromStaticPayloadType( payloadTypes[j]);
							}

							// Check if the codec is to be kept
							if ( codecRateChan != '' )
							{
								console.debug( "PT(" + payloadTypes[j] + "): " + codecRateChan + " FOUND in availableCodecSet.\n");
								codecArray.push( { payloadType: payloadTypes[j], codec: codecRateChan});
							}
						}
					}
					break;
				}
			}

			for ( i = 0 ; i < codecArray.length ; i++ )
			{
				console.debug( "codecArray[" + i + "] = " + codecArray[i].payloadType + ":" + codecArray[i].codec + "\n");
			}

			return codecArray;
		};

		this.getCodecsFromArray = function( codecArray)
		{
			var	i;
			var	codecSet = '';

			for ( i = 0 ; i < codecArray.length ; ++i )
			{
				if ( i > 0 )
				{
					codecSet = codecSet + ',';
				}
				codecSet = codecSet + codecArray[i].codec;
			}

			return	codecSet;
		};

		this.getCodecFromStaticPayloadType = function( payloadType)
		{
			var	codecRateChan;

			/*
			 *  Get the codec/samplingRate/Chan string
			 */
			switch ( payloadType )
			{
			case ( 0 ):  // G711u
				codecRateChan = "PCMU/8000";
				break;
			case ( 8 ):  // G711A
				codecRateChan = "PCMA/8000";
				break;
			case ( 9 ):  // G722
				codecRateChan = "G722/8000";
				break;
			case ( 13 ): // ComfortNoise
				codecRateChan = "CN/8000";
				break;
			case ( 18 ): // G729
				codecRateChan = "G729/8000";
				break;
			default:
				codecRateChan = '';
				break;
			}

			return	codecRateChan;
		};

		/**
		 * @summary Updates SDP for purposes of call recovery.
		 * @param {string} sdpoffer SDP
		 * @param {string} sdpType  'offer' or 'answer'
		 * @private
		 */
		this.updateSDPForCallRecovery = function( sdpoffer, sdpType)
		{
			var	availableCodecSet;

			console.debug("updateSDPForCallRecovery():" + "\n\tsdpType = " + sdpType +
				"\n\tlocalAudioCodecs count = " + self.localAudioCodecs.length +
				"\n\tlocalVideoCodecs count = " + self.localVideoCodecs.length );

                        if (   ( self.localAudioCodecs.length == 0 )
                            && ( self.localVideoCodecs.length == 0 ) )
                        {
				return sdpoffer;
                        }

			/*
			 *  For each media stream, we'll
			 *    - Get comma delimited list of codecs from array.
			 *    - Remove unavailable codecs from SDP.
			 *    - Substitute payloadTypes.
			 *  For service continuity call recovery, we'll want to use
			 *  the same payloadTypes that were in use during the base call
			 *  because the far-party will continue to send bearer traffic
			 *  to this local party using the same payloadTypes that were
			 *  originally in use.  This becomes most important when it was
			 *  the far-party that originated the call being recovered.
			 */
			// Audio
			availableCodecSet = self.getCodecsFromArray( self.localAudioCodecs);
			sdpoffer = self.updateSDPcodecs( sdpoffer, sdpType, 'audio', availableCodecSet);
			sdpoffer = self.updateSDPpayloadTypes( sdpoffer, sdpType, 'audio', self.localAudioCodecs);

			// Video
			availableCodecSet = self.getCodecsFromArray( self.localVideoCodecs);
			sdpoffer = self.updateSDPcodecs( sdpoffer, sdpType, 'video', availableCodecSet);
			sdpoffer = self.updateSDPpayloadTypes( sdpoffer, sdpType, 'video', self.localVideoCodecs);

			console.debug("updateSDPForCallRecovery() completed. SDP :\n" + sdpoffer.sdp + "\n");
			return sdpoffer;
		};

		/**
		 * @summary Updates SDP substituting payloadTypes.
		 * @param {string} sdpoffer SDP
		 * @param {string} sdpType  'offer' or 'answer'
		 * @param {string} mediaType 'audio' or 'video'
		 * @param {string} newPTArray Array of payloadTypes and codecs.
		 * @private
		 */
		this.updateSDPpayloadTypes = function( sdpoffer, sdpType, mediaType, newPTArray)
		{
			var	i, j;
			var 	sdpstr;
			var	changed = false;
			var	oldPTArray = []; 
			var	codecPTmap = [];
			var	PTmap = [];	// index of this array serves as old payloadType
			var	attrPT;		// payloadType from attribute line for potential update

			console.debug("updateSDPpayloadTypes():\n" + "\tsdpType = " + sdpType +
				"\n\tmediaType = " + mediaType +
				"\n\tnewPTArray count = " + newPTArray.length + "\n" );

                        if ( newPTArray.length == 0 )
                        {
				return sdpoffer;
                        }

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdpstr = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdpstr = sdpoffer.toSdp();
			} else {
				sdpstr = sdpoffer;
			}

			oldPTArray = self.getCodecsFromSDP( sdpstr, mediaType);

			/*
			 *  Create an old to new payloadType map for each codec.
			 *  A mapping element is created only if there is a
			 *  difference between old and new payloadTypes.
			 */
			codecPTmap.length = 0;
			for ( i = 0 ; i < oldPTArray.length ; ++i )
			{
				for ( j = 0 ; newPTArray.length ; ++j )
				{
					if ( oldPTArray[i].codec == newPTArray[j].codec )
					{
						/*
						 *  Add a mapping entry only if there
						 *  is a payloadType change.
						 */
						if ( oldPTArray[i].payloadType != newPTArray[j].payloadType )
						{
							codecPTmap.push( { codec: oldPTArray[i].codec,
								   oldPT: oldPTArray[i].payloadType,
								   newPT: newPTArray[j].payloadType } );
						}
						break;
					}
				}
			}

			if ( codecPTmap.length == 0 )
			{
				console.debug("updateSDPpayloadTypes(): No change in " + mediaType + " payloadTypes.\n");
				return sdpoffer;
			}
			else
			{
				// Initialize payloadType Map
				for ( i = 0 ; i < 128 ; ++i )
				{
					// index of this array serves as old payloadType
					PTmap.push( { substitutionNeeded: false,
						      newPT: i.toString() } );
				}

				// Save substitutions in payloadType Map
				for ( i = 0 ; i < codecPTmap.length ; i++ )
				{
					console.debug( "codecPTmap[" + i + "] = " + codecPTmap[i].codec + ":" +
							codecPTmap[i].oldPT + ":" + codecPTmap[i].newPT + "\n");
					// Save new payloadType
					PTmap[ parseInt(codecPTmap[i].oldPT) ].substitutionNeeded = true;
					PTmap[ parseInt(codecPTmap[i].oldPT) ].newPT = codecPTmap[i].newPT; 
				}
			}

/*
 *   Sample codec/payloadType SDP attributes to be updated:
 *   ----------------------------------------
 *   m=audio 1 RTP/SAVPF 111 103 104 0 8 106 105 13 126
 *   a=rtpmap:111 opus/48000/2
 *   a=fmtp:111 minptime=10
 *
 *   m=video 1 RTP/SAVPF 100 96
 *   a=rtpmap:100 VP8/90000
 *   a=rtcp-fb:100 ccm fir
 *   a=rtpmap:96 rtx/90000
 *   a=fmtp:96 apt=100
 *   
 */
			/*
			 *  Isolate the stream attributes of interest.
			 */
			sdpstr = sdpstr.split("\r\nm=");
			for ( i = 0 ; i < sdpstr.length ; i++ )
			{
				if ( sdpstr[i].indexOf( mediaType) == 0 )
				{
					/*
					 *  Walk the payloadTypes and perform
					 *  any needed substitutions.
					 */
					var lines = sdpstr[i].split("\r\n");
					var payloadTypes = lines[0].split(" ");

					/*
					 *  Skip past the media type, the portId and the transports
					 *  and walk the numeric payloadTypes.
					 */
					for ( j = 3 ; j < payloadTypes.length ; j++ )
					{
						//console.debug("PT(" + j + ") = " + payloadTypes[j] + "\n");
					
						// Verify we have a numeric payloadType
						if (   ( isNaN( payloadTypes[j]) == false )
						    && ( PTmap[ parseInt( payloadTypes[j]) ].substitutionNeeded ) )
						{
							// Effectively replace payloadType on m-line
							payloadTypes[j] = PTmap[ parseInt( payloadTypes[j]) ].newPT;
							changed = true;
						}
					}

					/* restore m line */
					lines[0] = payloadTypes.join(" ");

					/* Walk the remaining attribute lines */
					for ( j = 1 ; j < lines.length ; j++ )
					{
						if ( lines[j].indexOf( "a=rtpmap:") == 0 )
						{
							attrPT = parseInt( lines[j].substring(9));
							// replace payloadType on rtpmap line if necessary
						    	if ( PTmap[attrPT].substitutionNeeded )
							{
								// replace rtpmap line payloadType
								lines[j] = lines[j].replace( new RegExp( "a=rtpmap:"+attrPT+" ", "" ),
									"a=rtpmap:" + PTmap[attrPT].newPT + " " );
								changed = true;
							}
						}
						else if ( lines[j].indexOf( "a=fmtp:") == 0 )
						{
							var aptOffset;

							// replace payloadType on fmtp line if necessary
							attrPT = parseInt( lines[j].substring(7));
						    	if ( PTmap[attrPT].substitutionNeeded )
							{
								lines[j] = lines[j].replace( new RegExp( "a=fmtp:"+attrPT+" ", "" ),
									"a=fmtp:" + PTmap[attrPT].newPT + " " );
								changed = true;
							}

							/*
							 *  Check if this fmtp line also specifies
							 *  an associated payloadType.
							 */
							aptOffset = lines[j].indexOf( "apt=");
							if ( aptOffset != -1 )
							{
								attrPT = parseInt( lines[j].substring(aptOffset+4));
								// replace associated payloadType if necessary
								if ( PTmap[attrPT].substitutionNeeded )
								{
									lines[j] = lines[j].replace( new RegExp( " apt="+attrPT, "" ),
										" apt=" + PTmap[attrPT].newPT );
									changed = true;
								}
							}
						}
						else if ( lines[j].indexOf( "a=rtcp-fb:") == 0 )
						{
							attrPT = parseInt( lines[j].substring(10));
						    	if ( PTmap[attrPT].substitutionNeeded )
							{
								lines[j] = lines[j].replace( new RegExp( "a=rtcp-fb:"+attrPT+" ", "" ),
									"a=rtcp-fb:" + PTmap[attrPT].newPT + " " );
								changed = true;
							}
						}
					}

					sdpstr[i] = lines.join("\r\n");

					break;
				}
			}
			// restore sdpstr
			sdpstr = sdpstr.join("\r\nm=");

			if (changed === true) {
				console.debug("updateSDPpayloadTypes(), SDP has been updated.");
				//console.debug("updateSDPpayloadTypes(): UPDATED SDP = \n" + sdpstr + "\n\n");

				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription( {type:sdpType, sdp:sdpstr});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription( sdpstr);
				}
				return sdpstr;
			}

			console.debug("updateSDPpayloadTypes(), SDP has not been updated.");
			return sdpoffer;
		};

		/**
		 * @summary Updates SDP keeping user selected codecs.
		 * @param {string} sdpoffer SDP
		 * @param {string} sdpType  'offer' or 'answer'
		 * @param {string} mediaType 'audio' or 'video'
		 * @param {string} availableCodecSet Comma delimited list of available codecs (codec/rate[/chans])
		 * @private
		 */
		this.updateSDPcodecs = function( sdpoffer, sdpType, mediaType, availableCodecSet)
		{
			var	i, j;
			var 	sdpstr;
			var	changed = false;
			var	keepCodec;
			var     eolPattern = new RegExp("\r\n$");
			var     removeExtraCrLf = false;

			console.debug("updateSDPcodecs():\n" + "\tsdpType = " + sdpType + "\n" +
				"\tmediaType = " + mediaType + "\n" +
				"\tavailableCodecSet = " + availableCodecSet + "\n" );

                        if ( availableCodecSet == '' )
                        {
				return sdpoffer;
                        }

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdpstr = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdpstr = sdpoffer.toSdp();
			} else {
				sdpstr = sdpoffer;
			}

			// console.debug("updateSDPcodecs() sdp on entry:\n" + sdpstr) ;
/*
 *   Sample codec/payloadType SDP attributes:
 *   ----------------------------------------
 *   Chrome 38:
 *   ----------------------------
 *   m=audio 1 RTP/SAVPF 111 103 104 0 8 106 105 13 126
 *   a=rtpmap:111 opus/48000/2
 *   a=fmtp:111 minptime=10
 *   a=rtpmap:103 ISAC/16000
 *   a=rtpmap:104 ISAC/32000
 *   a=rtpmap:0 PCMU/8000
 *   a=rtpmap:8 PCMA/8000
 *   a=rtpmap:106 CN/32000
 *   a=rtpmap:105 CN/16000
 *   a=rtpmap:13 CN/8000
 *   a=rtpmap:126 telephone-event/8000
 *   m=video 1 RTP/SAVPF 100 116 117 96
 *   a=rtpmap:100 VP8/90000
 *   a=rtcp-fb:100 ccm fir
 *   a=rtcp-fb:100 nack
 *   a=rtcp-fb:100 nack pli
 *   a=rtcp-fb:100 goog-remb
 *   a=rtpmap:116 red/90000
 *   a=rtpmap:117 ulpfec/90000
 *   a=rtpmap:96 rtx/90000
 *   a=fmtp:96 apt=100
 *   a=ssrc-group:FID 3591557022 994605546
 *   a=ssrc:3591557022 cname:NThsnCB7KaizKuqO
 *   a=ssrc:3591557022 msid:UucVPZJPUuk1cP4AipzRcphpIjB8aYXw1SX1 b5c9cff2-b8c3-45fc-bb9e-7a94ebbfb5a0
 *   a=ssrc:3591557022 mslabel:UucVPZJPUuk1cP4AipzRcphpIjB8aYXw1SX1
 *   a=ssrc:3591557022 label:b5c9cff2-b8c3-45fc-bb9e-7a94ebbfb5a0
 *   a=ssrc:994605546 cname:NThsnCB7KaizKuqO
 *   a=ssrc:994605546 msid:UucVPZJPUuk1cP4AipzRcphpIjB8aYXw1SX1 b5c9cff2-b8c3-45fc-bb9e-7a94ebbfb5a0
 *   a=ssrc:994605546 mslabel:UucVPZJPUuk1cP4AipzRcphpIjB8aYXw1SX1
 *   a=ssrc:994605546 label:b5c9cff2-b8c3-45fc-bb9e-7a94ebbfb5a0
 *   
 *   ----------------------------
 *   FF34:
 *   ----------------------------
 *   m=audio 9 RTP/SAVPF 109 9 0 8 101
 *   a=rtpmap:109 opus/48000/2
 *   a=rtpmap:9 G722/8000
 *   a=rtpmap:0 PCMU/8000
 *   a=rtpmap:8 PCMA/8000
 *   a=rtpmap:101 telephone-event/8000
 *   a=fmtp:101 0-15
 *   m=video 9 RTP/SAVPF 120 126 97
 *   a=rtpmap:120 VP8/90000
 *   a=rtpmap:126 H264/90000
 *   a=fmtp:126 profile-level-id=42e01f;packetization-mode=1
 *   a=rtpmap:97 H264/90000
 *   a=fmtp:97 profile-level-id=42e01f
 *   a=rtcp-fb:120 nack
 *   a=rtcp-fb:120 nack pli
 *   a=rtcp-fb:120 ccm fir
 *   a=rtcp-fb:126 nack
 *   a=rtcp-fb:126 nack pli
 *   a=rtcp-fb:126 ccm fir
 *   a=rtcp-fb:97 nack
 *   a=rtcp-fb:97 nack pli
 *   a=rtcp-fb:97 ccm fir
 */
			/*
			 *  Strip codecs not listed in User specified
			 *  codecs to include in offers and answers per UI Config.
			 */
			sdpstr = sdpstr.split("\r\nm=");

			/*
			 *  The above split is used because splitting on "m=" alone
			 *  can create problems if a crypto sdp attribute happens to carry
			 *  a key-info parameter with "m=" embedded within it.
			 *  However, after the split above, the second to last element
			 *  will be missing "\r\n" at the end.  So we'll want to temporarily add this back
			 *  so that the last attribute line in that stream also ends in "\r\n"
			 *  and can be processed just like other attributes.
			 *  This will later be removed just before we rejoin the streams.
			 */
			if ( eolPattern.test( sdpstr[sdpstr.length-2]) === false )
			{
				sdpstr[sdpstr.length-2] = sdpstr[sdpstr.length-2] + "\r\n";
				removeExtraCrLf = true;
			}

			// Isolate the stream attributes of interest
			for ( i = 0 ; i < sdpstr.length ; i++ )
			{
				if ( sdpstr[i].indexOf( mediaType) == 0 )
				{
					/*
					 *  Walk the payloadTypes and remove any not associated
					 *  with codecs that are not specified to be kept.
					 */
					var lines = sdpstr[i].split("\r\n");
					var payloadTypes = lines[0].split(" ");

					/*
					 *  Skip past the media type, the portId and the transports
					 *  and walk the numeric payloadTypes.
					 */
					for ( j = 3 ; j < payloadTypes.length ; j++ )
					{
						//console.debug("PT(" + j + ") = " + payloadTypes[j] + "\n");
						keepCodec = true;
					
						// Verify we have a numeric payloadType
						if ( isNaN( payloadTypes[j]) == false )
						{
							var codecRateChan = '';
							var rtpmapLinePrefix = "a=rtpmap:" + payloadTypes[j] + " ";
							var indexOfRtpmap;
							var indexOfEndofRtpmapLine;

							indexOfRtpmap = sdpstr[i].indexOf( rtpmapLinePrefix);
							if ( indexOfRtpmap != -1 )
							{
								indexOfEndofRtpmapLine = sdpstr[i].indexOf( "\r\n", indexOfRtpmap);
							}

							/*
							 *  Get the codec/samplingRate/Chan string
							 *  associated with the payloadType so that we can check
							 *  for it in the configured codecs set.
							 */
							switch ( payloadTypes[j] )
							{
							case ( 0 ):  // G711u
								codecRateChan = "PCMU/8000";
								break;
							case ( 8 ):  // G711A
								codecRateChan = "PCMA/8000";
								break;
							case ( 9 ):  // G722
								codecRateChan = "G722/8000";
								break;
							case ( 13 ): // ComfortNoise
								codecRateChan = "CN/8000";
								break;
							case ( 18 ): // G729
								codecRateChan = "G729/8000";
								break;
							default:
								// dynamic payloadType or unknown static
								//  (get codecRateChan from rtpmap line)
								if ( indexOfRtpmap != -1 ) 
								{
									codecRateChan = sdpstr[i].substring( indexOfRtpmap + rtpmapLinePrefix.length, indexOfEndofRtpmapLine);
								}
								else
								{
									codecRateChan = '';
								}
								break;
							}

							// Check if the codec is to be kept
							if (   ( codecRateChan != '' )
							    && ( availableCodecSet.indexOf( codecRateChan) != -1 ) )
							{
								console.debug( "PT(" + payloadTypes[j] + "): " + codecRateChan + " FOUND in availableCodecSet.\n");
							}
							else
							{
								keepCodec = false;
								console.debug( "PT(" + payloadTypes[j] + "): " + codecRateChan + " NOT FOUND in availableCodecSet.\n");
							}
									
							if ( !keepCodec )
							{
								/* 
								 *  We will strip this codec's payloadType from the m= line
								 *  and remove any rtpmap line and associated fmtp attribute lines.
								 */
								var rtpmapStripExp = rtpmapLinePrefix + ".*\r\n";
								var fmtpStripExp = "a=fmtp:" + payloadTypes[j] + " " + ".*\r\n";
								var mLinePtStripExp1 = " " + payloadTypes[j] + " ";
								var mLinePtStripExp2 = " " + payloadTypes[j] + "\r";
								var mediaAttrLines;
								var ptPortion;

								// strip rtpmap lines
								sdpstr[i] = sdpstr[i].replace(  new RegExp( rtpmapStripExp, "g" ), "");
								// strip fmtp lines
								sdpstr[i] = sdpstr[i].replace(  new RegExp( fmtpStripExp, "g" ), "");
									
								/*
								 *  The payloadType number to be stripped from the m-line may
								 *  happen to also be the portId number.
								 *  For example:
								 *		m=audio 9 RTP/SAVPF 109 9 0 8 101
								 *  When we need to strip payloadType 9, we don't want to
								 *  touch the portId.
								 *  So we'll be sure to do the replacements only in the 
								 *  portion of the m-line that actually contains payloadTypes.
								 */
								mediaAttrLines = sdpstr[i].split("\n");
								ptPortion = mediaAttrLines[0].split("RTP");
								ptPortion[1] = ptPortion[1].replace( mLinePtStripExp1, " ");
								ptPortion[1] = ptPortion[1].replace( mLinePtStripExp2, "\r");
								mediaAttrLines[0] = ptPortion.join("RTP");
								sdpstr[i] = mediaAttrLines.join("\n");

								if ( mediaType == 'video' )
								{
									// strip rtcp feedback capability attribute lines
									var rtcpFbStripExp = "a=rtcp-fb:" + payloadTypes[j] + " " + ".*\r\n";
									sdpstr[i] = sdpstr[i].replace(  new RegExp( rtcpFbStripExp, "g" ), "");

									if (   ( codecRateChan != '' )
									    && ( codecRateChan.substr( 0, 4)  == 'rtx/') )
									{
										/*
										 *  If rtx is is being removed, we'll
										 *  need to remove an ssrc-group line
										 *  and the first set of 4 ssrc lines.
										 */
										var ssrcGrpStripExp = "a=ssrc-group:FID " + ".*\r\n";
										sdpstr[i] = sdpstr[i].replace(  new RegExp( ssrcGrpStripExp, "g" ), "");
										mediaAttrLines = sdpstr[i].split("\r\na=");
										mediaAttrLines.splice( mediaAttrLines.length - 8, 4) ;
										sdpstr[i] = mediaAttrLines.join("\r\na=");
									}
								}

								changed = true;
							}
						}
					}
					break;
				}
			}
			// restore sdpstr
			if ( removeExtraCrLf )
			{
				sdpstr[sdpstr.length-2] = sdpstr[sdpstr.length-2].substr( 0,
								sdpstr[sdpstr.length-2].length - 2);
			}
			sdpstr = sdpstr.join("\r\nm=");

			if (changed === true) {
				console.debug("updateSDPcodecs(), SDP has been updated.");
				//console.debug("updateSDPcodecs(): UPDATED SDP = \n" + sdpstr + "\n\n");

				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription( {type:sdpType, sdp:sdpstr});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription( sdpstr);
				}
				return sdpstr;
			}

			console.debug("updateSDPcodecs(), SDP has not been updated.");
			return sdpoffer;
		};

		/**
		 * @summary Updates a SDP to support DTLS.
		 * @param {string} direction incoming or outgoing of Offer/Answer. not incoming or outgoing Call
		 * @private
		 */
		this.updateSDPForDTLS = function (sdp, direction) {
			console.debug('updateSDPForDTLS(). direction=' + direction + ' config.crypto=' + this.session.config.providerConfig.crypto) ;
			var idx, outsdp = sdp ;

			if (this.session.config.providerConfig.crypto.toLowerCase() === "dtls-srtp") {
				if(direction == "incoming") {
					idx = outsdp.indexOf(" UDP/TLS/RTP/SAVPF ");
					if (idx !== -1) {
					    console.debug('Convert UDP/TLS/RTP/SAVPF to RTP/SAVPF');
					    outsdp = outsdp.replace(/ UDP\/TLS\/RTP\/SAVPF /g, " RTP/SAVPF ");
					}

				} else { // outgoing
					idx = outsdp.indexOf(" RTP/SAVPF ");
					if (idx !== -1) {
					    console.debug('Convert RTP/SAVPF to UDP/TLS/RTP/SAVPF');
					    outsdp = outsdp.replace(/ RTP\/SAVPF /g, " UDP/TLS/RTP/SAVPF ");
					    console.debug('crypto is dtls-srtp. removing a=crypto lines');
					    outsdp = outsdp.replace(/a=crypto.*\r\n/g, "");
					}
				}
			} else {
				console.debug("crypto is not dtls-srtp. removing fingerprint lines") ;
				outsdp = outsdp.replace(/a=fingerprint.*\r\n/g, "");
			}
			return outsdp;
		};

		/**
		 * @summary Updates a SDP.
		 * @param {string} sdp SDP
		 * @private
		 */
		this.updateSDPAddCodecs = function (sdpoffer) {
			console.debug('updateSDPAddCodecs()');
			var sdp, changed, m;
			var offsetToSessionLevelMode;
			var portId;

			if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
				sdp = sdpoffer.sdp;
			} else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
				sdp = sdpoffer.toSdp();
			} else {
				sdp = sdpoffer;
			}

			m = sdp.split('\r\nm=');
			offsetToSessionLevelMode = m[0].indexOf('a=inactive');
			if ( offsetToSessionLevelMode == -1 )
			{
				offsetToSessionLevelMode = m[0].indexOf('a=sendonly');
			}

			/*
			 *  We want to perform codec changes to add OPUS and/or VP8
			 *  if (   ( stream-level mode is 'inactive' )
			 *      || ( stream-level mode is 'sendonly' )
			 *      || (   ( stream-level mode is unspecified )
			 *          && ( session-level mode is 'inactive' or 'sendonly') )
			 *      || ( portId == 0 ) )
			 */

			changed = false;

			// should RTP/AVP be tolerated ?
			if ((/m=video .* RTP\/SAVPF/).test(sdp) && !(/a=rtpmap:.* VP8\//).test(sdp)) {
				m = sdp.split('\r\nm=');
				for (var i = 0; i < m.length; i++) {
					if (m[i].indexOf('video') == 0) {
						portId = parseInt( m[i].slice(6));
						if (   ( m[i].indexOf('a=inactive') >= 0 )
						    || ( m[i].indexOf('a=sendonly') >= 0 )
						    || (   ( m[i].indexOf('a=sendrecv') == -1 )
						        && ( m[i].indexOf('a=recvonly') == -1 )
						        && ( offsetToSessionLevelMode >= 0 ) )
						    || ( portId == 0 ) )
						{
							changed = true;
							m[i] = m[i]
							.replace(/\r\na=rtpmap:.*/g, '')
							.replace(/\r\na=fmtp:.*/g, '')
							.replace(/(video .* RTP\/SAVPF)(.*)/, '$1 100\r\na=rtpmap:100 VP8/90000');
							sdp = m.join('\r\nm=');
						}
						break;
					}
				}
			}
			if ((/m=audio .* RTP\/SAVPF/).test(sdp) && !(/a=rtpmap:.* opus\//).test(sdp)) {
				m = sdp.split('\r\nm=');
				for (var i = 0; i < m.length; i++) {
					if (m[i].indexOf('audio') == 0) {
						portId = parseInt( m[i].slice(6));
						if (   ( m[i].indexOf('a=inactive') >= 0 )
						    || ( m[i].indexOf('a=sendonly') >= 0 )
						    || (   ( m[i].indexOf('a=sendrecv') == -1 )
						        && ( m[i].indexOf('a=recvonly') == -1 )
						        && ( offsetToSessionLevelMode >= 0 ) )
						    || ( portId == 0 ) )
						{
							changed = true;
							m[i] = m[i].replace(/(audio .*)/, '$1 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10');
							console.debug("adding opus") ;
							sdp = m.join('\r\nm=');
						}
						break;
					}
				}
			}

			if (changed === true) {
				console.debug("updateSDPAddCodecs() SDP has been updated:" + sdp);
				if (RTCSessionDescription && sdpoffer instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:'offer', sdp:sdp});
				}
				else if (window.SessionDescription && sdpoffer instanceof SessionDescription) {
					return new SessionDescription(sdp);
				}
				return sdp;
			}
			console.debug("updateSDPAddCodecs() SDP has not been updated)");
			return sdpoffer;
		};


		/**
		 * @summary Updates a SDP.
		 * @param {string} type Type of SDP (offer or answer)
		 * @private
		 */
		this.updateSDPForTempWorkarounds = function (sdp, type) {
			console.debug("updateSDPForTempWorkarounds(). type=" + type);
			var outsdp, idx, changed, rtpmap, mstart;
			if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
				outsdp = sdp.sdp;
			} else if (window.SessionDescription && sdp instanceof SessionDescription) {
				outsdp = sdp.toSdp();
			} else {
				outsdp = sdp;
			}

			changed = false;
			idx = outsdp.indexOf("acap:");
			if (idx !== -1) {
				// remove acap in the crypto line
				changed = true;
				console.debug('Removed acap from crypto lines');
				outsdp = outsdp.replace(/acap.*crypto/g, "crypto");
			}
			idx = outsdp.indexOf(" RTP/AVP ");
			//do this only if acap crypto exists
			if (idx !== -1 && changed === true) {
				// replace it with RTP/SAVPF.
				changed = true;
				console.debug('Convert RTP/AVP to RTP/SAVPF');
				outsdp = outsdp.replace(/ RTP\/AVP /g, " RTP/SAVPF ");
			}
			idx = outsdp.indexOf("SAVP ");
			if (idx !== -1) {
				// Chrome26+ is strict about getting RTP/SAVPF in SDP answer. if RTP/SAVP is received
				// replace it with RTP/SAVPF.
				changed = true;
				console.debug('Convert SAVP to SAVPF');
				outsdp = outsdp.replace(/SAVP /g, "SAVPF ");
			}
			//changing rtpmap number in re-INVITE seems causing Chrome error. Currently only for telephone-event
			if(type === 'offer'){
				rtpmap = outsdp.match(/a=rtpmap:(\d+) telephone-event/);
				console.debug("this.telephoneEvent=" + this.telephoneEvent);
				if(rtpmap && rtpmap.length > 1){
					if(this.telephoneEvent){
						console.debug('this.telephone-event: ' + this.telephoneEvent + ' and rtpmap in SDP is: ' + rtpmap);
						if (this.telephoneEvent !== rtpmap[1]) {
							if (outsdp.indexOf('\r\na=rtpmap:' + this.telephoneEvent) > -1) {
								// If the telephone-event payload type number is used by other codec, replace with an available dynamic payload type
								for (idx = 96 ; idx <= 127; idx += 1) {
									if (outsdp.indexOf('a=rtpmap:' + idx) < 0 && idx !== this.telephoneEvent) {
										mstart = '(\r\nm=[a-zA-Z]+ [0-9]+ [\/a-zA-Z]+[ 0-9]* )' + this.telephoneEvent + '( |\r\n)([ 0-9]*\r?\n?)';
										outsdp = outsdp.replace(new RegExp(mstart, 'g'), '$1' + idx + '$2$3')
											.replace(new RegExp('\r\na=rtpmap:' + this.telephoneEvent, 'g'), '\r\na=rtpmap:' + idx)
											.replace(new RegExp('\r\na=fmtp:' + this.telephoneEvent, 'g'), '\r\na=fmtp:' + idx);
										break;
									}
								}
							}
							mstart = '(\r\nm=[a-zA-Z]+ [0-9]+ [\/a-zA-Z]+[ 0-9]* )' + rtpmap[1] + '( |\r\n)([ 0-9]*\r?\n?)';
							outsdp = outsdp.replace(new RegExp(mstart, 'g'), '$1' + this.telephoneEvent + '$2$3')
								.replace(new RegExp('\r\na=rtpmap:' + rtpmap[1], 'g'), '\r\na=rtpmap:' + this.telephoneEvent)
								.replace(new RegExp('\r\na=fmtp:' + rtpmap[1], 'g'), '\r\na=fmtp:' + this.telephoneEvent);
							changed = true;
						}
					}
					else{
						console.debug('set this.telephone-event to: ' + rtpmap[1]);
						this.telephoneEvent = rtpmap[1];
					}
				}
			}


			// Remove dummy fingerprint line
			if ( outsdp.indexOf("a=fingerprint:dummyFunc") !== -1 ) {
				outsdp = outsdp.replace(/a=fingerprint:dummyFunc.*\r\n/, "");
				console.log("Removing dummy fingerprint line");
				changed = true;
			}

			/* DataChannel fix for FF 37 */
			idx = outsdp.indexOf("webrtc-DataChannel");
			if (idx !== -1) {
				console.log("Mapping webrtc-DataChannel to webrtc-datachannel 16");
				outsdp = outsdp.replace(/webrtc-DataChannel/g, "webrtc-datachannel 16");
				changed = true;
			}

			if (changed) {
				console.debug('updateSDPForTempWorkarounds() SDP has been updated:' + outsdp);
				if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:type, sdp:outsdp});
				}
				else if (window.SessionDescription && sdp instanceof SessionDescription) {
					return new SessionDescription(outsdp);
				}
				return outsdp ;
			}
			return sdp;
		};

		/**
		 * @summary Updates a SDP.
		 * @param {string} type Type of SDP (offer or answer)
		 * @param {string} iceoption Ice option to force in the SDP
		 * @private
		 */
		this.updateSDPMediaIceOption = function (sdp, type, iceoption) {
			console.debug('updateSDPMediaIceOption()');
			var outsdp, idx;
			if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
				outsdp = sdp.sdp;
			} else if (window.SessionDescription && sdp instanceof SessionDescription) {
				outsdp = sdp.toSdp();
			} else {
				outsdp = sdp;
			}

			idx = outsdp.indexOf("a=ice-options:google-ice");
			if (idx === -1) {
				outsdp = outsdp.replace(/\r\na=ice-ufrag/g, "\x0d\x0aa=ice-options:"+ iceoption + "\x0d\x0aa=ice-ufrag");
				// remove "a=ice-lite" string
				//outsdp = outsdp.replace("a=ice-lite\r\n", "");
			}

			//console.debug('updateSDPMediaIceOption() SDP has been updated:' + outsdp);

			if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
				return new RTCSessionDescription({type:type, sdp:outsdp});
			}
			else if (window.SessionDescription && sdp instanceof SessionDescription) {
				return new SessionDescription(outsdp);
			}
			return outsdp;
		};

		/**
		 * @summary Updates a SDP.
		 * @private
		 */
		this.updateSDPBandwidth = function (sdp, type) {
			var audioB, videoB, dataB, outsdp, m, i;
			audioB = this.getIntOrZero(this.session.config.providerConfig.audioBandwidth);
			videoB = this.getIntOrZero(this.session.config.providerConfig.videoBandwidth);
			dataB = this.getIntOrZero(this.session.config.providerConfig.dataBandwidth);
			if (audioB <= 0 && videoB <= 0 && dataB <= 0) {
				console.debug('updateSDPBandwidth() no change, no bandwidth values given');
				return sdp;
			}

			console.debug('updateSDPBandwidth() audioB=' + audioB + ' videoB=' + videoB + ' dataB=' + dataB);
			if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
				outsdp = sdp.sdp;
			} else if (window.SessionDescription && sdp instanceof SessionDescription) {
				outsdp = sdp.toSdp();
			} else {
				outsdp = sdp;
			}

			changed = false;
			m = outsdp.split('\r\nm=');
			for (i = 0; i < m.length; i += 1) {
				if (audioB > 0 && m[i].indexOf('audio') == 0) {
					changed = true;
					m[i] = this.updateMediaBandwidth(m[i], audioB);
				}
				if (videoB > 0 && m[i].indexOf('video') == 0) {
					changed = true;
					m[i] = this.updateMediaBandwidth(m[i], videoB);
				}
				if (dataB > 0 && m[i].indexOf('application') == 0) {
					changed = true;
					m[i] = this.updateMediaBandwidth(m[i], dataB);
				}
			}

			if (changed) {
				outsdp = m.join('\r\nm=');
				console.debug('updateSDPBandwidth() SDP has been updated:' + outsdp);
				if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:type, sdp:outsdp});
				}
				else if (window.SessionDescription && sdp instanceof SessionDescription) {
					return new SessionDescription(outsdp);
				}
				return outsdp;
			}
			console.debug('updateSDPBandwidth() SDP not changed');
			return sdp;
		};

		/**
		 * @summary Updates a SDP.
		 * @private
		 */
		this.updateSDPDataChannel = function (sdp, type) {
			var mediatype, outsdp, changed, m, i, j, addlines, server, port, payloadtype, fname, fsize, ftype;
			mediatype = this.getMediaTypes();
			if (mediatype !== 'chat' && mediatype !== 'filetransfer' && mediatype !== 'imageshare') {
				return sdp;
			}
			if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
				outsdp = sdp.sdp;
			} else if (window.SessionDescription && sdp instanceof SessionDescription) {
				outsdp = sdp.toSdp();
			} else {
				outsdp = sdp;
			}
			changed = false;
			m = outsdp.split('\r\nm=');
			for (i = 0; i < m.length; i += 1) {
				port = (/^application ([^\s]*) [^\s]* ([^\s]*)/).exec(m[i]); //m=application 3000 DTLS/SCTP 5000
				if (port) {
					payloadtype = port[2];
					port = port[1];
					addlines = '';
					if (m[i].indexOf('a=data-channel:') < 0) {
						//TODO: unique label?
						addlines += 'a=data-channel:' + payloadtype + ' stream=0;label="orca";subprotocol="MSRP"\r\n';
					}
					if (!(/a=dcsa:[^\s]* accept-types:/).test(m[i])) {
						addlines += 'a=dcsa:' + payloadtype + ':0 accept-types:';
						//addlines += 'text/plain\r\n';
						
						switch (mediatype) {
						case 'chat':
							// example to accept other formats: accept-types:message/cpim text/plain text/html
							addlines += 'text/plain message/CPIM\r\n';
							break;
						case 'imageshare':
							addlines += 'message/CPIM application/octet-stream image/*\r\n';
							break;
						case 'filetransfer':
							addlines += 'message/CPIM application/octet-stream\r\n';
							break;
						default:
							addlines += '*\r\n';
						}
						
					}
					if (!(/a=dcsa:[^\s]* path:/).test(m[i])) {
						server = (/\r\nc=[^\s]* [^\s]* ([^\s]*)/).exec(m[i]);
						if (server) {
							server = server[1];
							if (!this.msrpFromPath) {
								this.msrpSessionId = Math.random().toString(36).substr(2, 16);
								this.msrpFromPath = 'msrps://' + server + ':' + port + '/' + this.msrpSessionId + ';dc';
							}
							addlines += 'a=dcsa:' + payloadtype + ':0 path:' + this.msrpFromPath + '\r\n';
						}
					}
					if (this.msrpFile && !(/a=dcsa:[^\s]* file-selector:/).test(m[i])) {
						fname = encodeURIComponent(this.msrpFile.name || 'file');
						fsize = this.msrpFile.size || 0;
						ftype = this.msrpFile.type || 'application/octet-stream';
						addlines += 'a=dcsa:' + payloadtype + ':0 file-selector:name:"'
								+ fname + '" type:' + ftype + ' size:' + fsize + '\r\n';
						//TODO hash value
					}
					if (m[i].indexOf('a=connection:new') < 0) {
						addlines += 'a=connection:new\r\n';
					}
					if (m[i].indexOf('a=sendrecv') < 0 && m[i].indexOf('a=sendonly') < 0
							&& m[i].indexOf('a=recvonly') < 0 && m[i].indexOf('a=inactive') < 0) {
						addlines += 'a=sendrecv\r\n';
					}
					if (addlines.length > 0) {
						changed = true;
						m[i] = m[i].replace(/^(.*\r\n)/, '$1' + addlines);
					}
				}
			}

			if (changed) {
				outsdp = m.join('\r\nm=');
				console.debug('updateSDPDataChannel() SDP has been updated:' + outsdp);
				if (RTCSessionDescription && sdp instanceof RTCSessionDescription) {
					return new RTCSessionDescription({type:type, sdp:outsdp});
				}
				else if (window.SessionDescription && sdp instanceof SessionDescription) {
					return new SessionDescription(outsdp);
				}
				return outsdp;
			}
			return sdp;
		};

		/**
		* Modify SDP of initial hold
		* @private
		*/
		this.updateSDPInitialHold = function (sdp) {
			var m, i, a, changed;
			// If session description has a=sendonly, but media descriptions omit it, Chrome responds with sendrecv.
			// Force explicit sendonly in media descriptions so Chrome should respond with recvonly.
			m = sdp.split('\r\nm=');
			for (i = 1; i < m.length; i += 1) {
				if (m[i].indexOf('\r\na=sendonly') < 0) {
					a = m[i].indexOf('\r\na=');
					if (a < 0) {
						a = m[i].indexOf('\r\n');
					}
					m[i] = m[i].slice(0, a) + '\r\na=sendonly' + m[i].slice(a);
					changed = true;
				}
			}
			if (changed) {
				sdp = m.join('\r\nm=');
				console.debug('updateSDPInitialHold() SDP has been updated:' + sdp);
			} else {
				console.debug('updateSDPInitialHold() No change');
			}
			return sdp;
		};
		
		/**
		* Update SDP media description with a bandwidth value
		* @private
		*/
		this.updateMediaBandwidth = function (m, value) {
			if (m.indexOf('\r\nb=AS:') > -1) {
				return m.replace(/\r\nb=AS:.*/, '\r\nb=AS:' + value); // replace existing b=AS line
			}
			return m.replace(/(.*)/, '$1\r\nb=AS:' + value); // place it under the first line
		};

		/**
		* Try to parse as integer, otherwise return zero
		* @private
		*/
		this.getIntOrZero = function (value) {
			if (value && !isNaN(parseInt(value))) {
				return parseInt(value);
			}
			return 0;
		};

//		/**
//		* @summary Do a hold and unhold to ensure a fresh video frame is sent
//		*/
//		this.refreshFrame = function () {
//			setTimeout(function () { self.hold(); }, 500);
//			setTimeout(function () { self.resume(); }, 800);
//		};

		/** 
		 * @summary Determines if a re-invite is a request to place a call on hold
		 * @returns {boolean} 
		 * @private
		 */
		this.isHoldRequest = function( oldAudioDirection, oldVideoDirection )
		{
		
			// For now, we don't consider the case that the call could have both audio and video but
			// have different directions for each.
			
			if (( this.audioMediaDirection == 'sendonly' || this.audioMediaDirection == 'inactive' ) &&
				( oldAudioDirection == 'sendrecv' ) )
			{
				return true;
			}
				
			if (( this.videoMediaDirection == 'sendonly' || this.videoMediaDirection == 'inactive' ) &&
				( oldVideoDirection == 'sendrecv' ) )
			{
				return true;
			}
				
			return false;
		}

		/**
		* @summary Parses the SDP.
		* @returns {boolean} Flag indicating that the parsing of SDP is successful
		* @private
		*/
		this.parseSDP = function () {
			var sdp, sdpstr, sdpstr2, idx;
			// convert between sdes and dtls
			this.sdpOffer = this.updateSDPForDTLS(this.sdpOffer, 'incoming');
			if (this.sdpOffer.search("m=message") !== -1) {
				if ((this.sdpOffer.search("TCP/MSRP") !== -1) || (this.sdpOffer.search("TCP/TLS/MSRP") !== -1)) {
					return false;
				}
			}

			this.mediaTypes = this.mediaTypeFromSdp(this.sdpOffer);

			sdp = this.sdpOffer;
			sdpstr = this.sdpOffer;
			idx = -1;
			
			audio_start = sdp.indexOf('audio');
			video_start = sdp.indexOf('video');
			if ( audio_start < video_start )
			{
				audio_end = video_start;
				video_end = sdp.length;
			}
			else
			{
				video_end = audio_start;
				audio_end = sdp.length;
			}
			var audio_sdp = sdp.slice(audio_start, audio_end);
			var video_sdp = sdp.slice(video_start, video_end);
			
			 if (this.mediaTypes.indexOf('audio') !== -1) {
				idx = audio_sdp.indexOf("a=sendrecv");
				if (idx === -1) {
					idx = audio_sdp.indexOf("a=sendonly");
					if (idx === -1) {
						idx = audio_sdp.indexOf("a=recvonly");
						if (idx === -1) {
							idx = audio_sdp.indexOf("a=inactive");
						}
					}
				}
				if (idx !== -1) {
					this.audioMediaDirection = audio_sdp.substr(idx+2, 8);
				}
			}

			if (this.mediaTypes.indexOf('video') !== -1) {
				idx = video_sdp.indexOf("a=sendrecv");
				if (idx === -1) {
					idx = video_sdp.indexOf("a=sendonly");
					if (idx === -1) {
						idx = video_sdp.indexOf("a=recvonly");
						if (idx === -1) {
							idx = video_sdp.indexOf("a=inactive");
						}
					}
				}
				if (idx !== -1) {
					this.videoMediaDirection = video_sdp.substr(idx+2, 8);
				}
			}
			return true;
		};

		/**
		* @summary Accept an incoming call.
		* @private
		*/
		this.accept = function () {
			console.debug("Call.accept()");
			// if (params) {
				// // update call's audio stream
				// if (params.audio !== callParams.audioMediaDirection) {
					// if (isDebugEnabled() === true)  onDebug("acceptCall() audio: " + callParams.audioMediaDirection + " => " + params.audio);
					// callParams.audioMediaDirection = params.audio;
				// }
				// // update call's video stream
				// if (params.video !== callParams.videoMediaDirection) {
					// if (isDebugEnabled() === true)  onDebug("acceptCall() video: " + callParams.videoMediaDirection + " => " + params.video);
					// callParams.videoMediaDirection = params.video;
				// }
			// }

			this.callStatus = this.CallStatus.ACCEPTED;
			//this.sendInviteResponse(200, 'OK');
			this.markActionNeeded();
		};

		/**
		* @summary Deletes allocated resources associated to this Call.
		* @private
		*/
		this.clean = function () {
			console.debug("Call.clean() calls.length: " + this.session.calls.length);
			this.session.adapter.cleanCallSession(this);
			var i;
			for(i=0; i < this.session.calls.length; i+=1) {
				if(this.session.calls[i].callId === this.callId){
					console.debug('remove call ' + this.session.calls[i] + '(' + this.callId + ')');
					this.session.calls.splice(i, 1);
					break;
				}
			}
			console.debug("Call.clean() calls.length: " + this.session.calls.length);

			if (this.dataChannel) {
				this.dataChannel.close();
				this.dataChannel = null;
			}

			if (this.pc) {
				this.pc.close();
				this.pc = null;
			}
            
            if (this.msrpFile) {
                this.msrpFile = null;
            }
		};

		/**
		* @summary Sets call status. Called by adapter
		*/
		this.setCallStatus = function(status) {
			// TODO: check status is CallStatus?
			this.callStatus = status;
			var evt = {name: this.callStatus};
			this.callback.onStatus(this.callStatus, evt);
		};

		/**
		* @summary Notifies call event. Called by adapter
		*/
		this.incomingCallSessionEvent = function(evt) {
			var event, res, sdp, comm,
				offerMLineCount, answerMLineCount, offerHasRemovedVideo,
				answerHasRemovedVideo, currentInviteSendOnly, previousResponseRecvOnly;
			console.debug("Call.incomingCallSessionEvent() event: " + evt.name + " status: " + this.callStatus);
			//received ACK. no ACK for REST, needs to be called internally in restAdapter
			if(evt.name === 'confirmed'){
				if (this.callStatus === this.CallStatus.REFUSED) {
					this.callback.onDisconnected({name: CallStatus.REJECTED});
					this.clean();
					return;
				 }
				else if (this.callStatus === this.CallStatus.CANCELED) {
					this.callback.onDisconnected({name: CallStatus.CANCELED});
					this.clean();
					return;
				}
				
				if (this.holdPending) {
					this.holdPending = false;
					this.callStatusExternal = CallStatus.REMOTE_HOLD;
					this.callStatus = this.CallStatus.REMOTE_HOLD;
					event = {name:CallStatus.REMOTE_HOLD};
					this.callback.onStatus(CallStatus.REMOTE_HOLD, event);
				} else {
					this.activeCall = true;
					this.callStatus = this.CallStatus.CONFIRMED;
					if (this.callStatusExternal === CallStatus.HOLD || this.callStatusExternal === CallStatus.REMOTE_HOLD) {
						this.callStatusExternal = CallStatus.UNHOLD;
						event = {name:CallStatus.UNHOLD};
						this.callback.onStatus(CallStatus.UNHOLD, event);
					} else {
						this.callStatusExternal = CallStatus.CONNECTED;
						event = {name:CallStatus.CONNECTED};
						this.callback.onConnected(event);
					}
				}
				// if ACK includes sdp
				if (evt.sdp) {
					// we receive the SDP answer in ACK
					console.debug('received sdp in ACK: ' + evt.sdp);
					sdp = evt.sdp;
					sdp = this.updateSDPForTempWorkarounds(sdp, "answer");
					if (this.session.config.providerConfig.addCodecs) {
						sdp = this.updateSDPAddCodecs(sdp);
					}
					sdp = this.updateSDPForDTLS(sdp, 'incoming');//Convert UDP/TLS/RTP/SAVPF to RTP/SAVPF before calling setRemoteDescription

					sdp=this.updateMSID(sdp);
					
					console.trace("receivedAck() setRemoteDescription sdp = " + sdp);
					this.pc.setRemoteDescription(new RTCSessionDescription({type:'answer', sdp:sdp}), 
						this.setRDsuccess,
						this.setRDfailure2);
					this.setMediaTypeFromSdp(sdp);
				}				
				return;
			}
			else if(evt.name === 'canceled'){
				console.debug("incomingCallSessionEvent: canceled: " + this.callStatus);
				if(this.callStatus === this.CallStatus.RINGING && this.callDirection === this.CallDirection.INCOMING) {
					this.callStatus = this.CallStatus.CANCELED; 
					this.callStatusExternal = CallStatus.CANCELED; 
					//call will be cleaned and notified in ACK
					//event = {name: CallStatus.CANCELED};
					//this.callback.onDisconnected(event);
				}
				else {
					console.warn('invalid call status when receiving cancelled event ' + this.callStatus);
				}
				return;
			}

			//received INVITE or REST call
			if (this.session.config.providerConfig.confWorkaroundChrome) {
				this.inviteCount += 1;
			}
			this.callDirection = this.CallDirection.INCOMING;
			if ((this.callStatus === this.CallStatus.IDLE) || ((this.activeCall === true) && 
				(this.callStatus === this.CallStatus.CONFIRMED || 
				 this.callStatus === this.CallStatus.REMOTE_HOLD ||
				 this.callStatus === this.CallStatus.HOLD))) {
				sdp = evt.sdp;
				if(evt.callId)
					this.callId = evt.callId;
				if(evt.uaCall)
					this.uaCall = evt.uaCall;
				if(evt.from){
					this.targetAOR = [evt.from];
					this.remotePeerIds = [{id:this.targetAOR[0]}];
				}
				
				if (sdp) {
					// we received a SDP offer
					this.sdpOffer = sdp;
					// save current media direction
					old_audioMediaDirection = this.audioMediaDirection;
					old_videoMediaDirection = this.videoMediaDirection;

					res = this.parseSDP();
					if (res === false) {
						console.warn("Call.receivedInvite() received a SDP offer with unsupported media");
						this.session.sendResponse(this, 488, 'Not Acceptable Here');
						return;
					}
 					if (this.session.config.providerConfig.confWorkaroundChrome
							&& this.inviteCount === 1 && typeof this.mediaTypes === 'string'
 							&& (this.mediaTypes.indexOf('audio') > -1 || this.mediaTypes.indexOf('video') > -1)) {
 						this.initialHoldOffer = this.sdpHasDirection(this.sdpOffer, 'sendonly');
 						if (this.initialHoldOffer) {
 							// This might be a conference invite with an initial hold.
 							// Expect one or two reINVITEs, the last of which will be an unhold.
 							console.log('Conference workaround: First invte.');
 							this.sdpOffer = this.updateSDPInitialHold(this.sdpOffer);
 						}
 					}
					if (this.session.config.providerConfig.addCodecs) {
						this.sdpOffer = this.updateSDPAddCodecs(this.sdpOffer);
					}
				} else {
					//this.mediaTypes = 'audio,video';
					console.debug( "receivedInvite() received bodiless INVITE:\n" +
						"\tset media type to " + this.session.config.mediatypes +
						"\tUnsetting previous SDP offer, so that a new offer is created." +
						"\tcallStatus = " + this.callStatus);
					this.mediaTypes = this.session.config.mediatypes;
					this.audioMediaDirection = 'sendrecv';
					this.videoMediaDirection = 'sendrecv';

					if ( this.sdpOffer != undefined ) {
						this.sdpOffer = undefined;
						this.bodilessReInvite = true;
						console.log( "bodilessReInvite = true\n");
					}
					this.sdpOffer = undefined;
				}
				if (this.session.config.providerConfig.dtmfWorkaround && !this.isSendingDtmf) {
					// Workaround for MRF DTMF
					comm = this.sdpOffer ? this.sdpOffer.match(/\r\na=rtpmap:(\d+) telephone-event/) : false;
					if (comm) {
						if (this.sdpHasDirection(this.sdpOffer, 'sendonly', 'audio') || this.sdpHasDirection(this.sdpOffer, 'inactive', 'audio')) {
							this.sdpOffer = this.sdpOffer
								.replace(new RegExp('(\\r\\nm=[a-zA-Z]+ [0-9]+ [a-zA-Z/]+[0-9 ]*) ' + comm[1] + '(\\r\\n| [0-9 ]+\\r\\n)'), '$1$2')
								.replace(new RegExp('\\r\\na=rtpmap:' + comm[1] + '.*'), '')
								.replace(new RegExp('\\r\\na=fmtp:' + comm[1] + '.*'), '');
						} else {
							this.isSendingDtmf = true;
						}
					}
				}
				//re-INVITE
				if (this.activeCall === true) {
					if (this.session.config.providerConfig.confWorkaroundChrome && this.initialHoldOffer) {
						// scenario (different # of m= lines): 1st INVITE has just audio, 2nd INVITE has m=video with port 0
						offerMLineCount = (typeof this.sdpOffer === 'string') ? this.sdpOffer.split('\r\nm=').length : 0;
						answerMLineCount = this.pc.localDescription.sdp.split('\r\nm=').length;
						
						// scenario (same # of m= lines): 1st INVITE has just audio+video (both vlid ports), 2nd INVITE has m=video with port 0
						offerHasRemovedVideo = (typeof this.sdpOffer === 'string' && this.sdpOffer.indexOf('m=video 0 ') > -1);
						answerHasRemovedVideo = this.pc.localDescription.sdp.indexOf('m=video 0 ') > -1;
						
						if (answerMLineCount === offerMLineCount && offerHasRemovedVideo === answerHasRemovedVideo) {
							currentInviteSendOnly = this.sdpHasDirection(this.sdpOffer, 'sendonly');
							previousResponseRecvOnly = this.sdpHasDirection(this.pc.localDescription.sdp, 'recvonly');
							if (!currentInviteSendOnly) {
								// First non-hold offer. Resume normal call flow for reINVITEs after this.
								this.initialHoldOffer = false;
							}
							if (!previousResponseRecvOnly || currentInviteSendOnly) {
								// Send 200OK without renegotiation to all consecutive hold offers after the initial one.
								// If the previous response was recvonly, renegotiate when the first non-hold offer is received.
								// Otherwise, send 200OK without renegotiation to the first non-hold offer.
								console.log('Conference workaround: Not doing setRemote/createAnswer, instead sending 200OK with earlier answer.'
										+ ' (invteCount=' + this.inviteCount + ', continue=' + this.initialHoldOffer + ')');
								sdp = this.updateSDPForDTLS(this.pc.localDescription.sdp, 'outgoing');
								this.session.adapter.sendResponse(this, 200, 'OK', sdp);
								return;
							}
						} else {
							// Some other type of offer. Resume normal call flow for reINVITEs after this.
							this.initialHoldOffer = false;
						}
						console.log('Conference workaround: Do setRemote/createAnswer.'
								+ ' (invteCount=' + this.inviteCount + ', continue=' + this.initialHoldOffer + ')');
					}
					if (this.oldMediaTypes) {
						if (this.oldMediaTypes.indexOf('video') === -1 && this.mediaTypes.indexOf('video') !== -1) {
							console.debug('receivedInvite(): upgrade');
							this.callStatus = this.CallStatus.UPGRADING;
							this.callStatusExternal = CallStatus.UPGRADING;
							event = {name: CallStatus.UPGRADING};
							this.callback.onStatus(CallStatus.UPGRADING, event);
						}
						else if (this.oldMediaTypes.indexOf('video') !== -1 && this.mediaTypes.indexOf('video') === -1) {
							console.debug('receivedInvite(): downgrade');
							this.callStatus = this.CallStatus.DOWNGRADING;
							this.callStatusExternal = CallStatus.DOWNGRADING;
							event = {name: CallStatus.DOWNGRADING};
							this.callback.onStatus(CallStatus.DOWNGRADING, event);
						}
						else if (this.isHoldRequest(old_audioMediaDirection, old_videoMediaDirection)) {
							this.holdPending = true;
							this.accept();
						} 
						else {
							this.accept();
						}
					}
				} else {
					this.isTiledVideo = this.mediaTypes.indexOf('video') > -1 &&
						(/Alcatel-Lucent-HPSS/).test(evt.uaString);
					//this.callDirection = this.CallDirection.INCOMING;
					switch (this.mediaTypes.toLowerCase()) {
					case 'filetransfer':
						comm = this.session.callback.createFileTransfer(this.targetAOR[0]);
						comm.getImp().setWrappedCall(this.callback);
						event = {name: SessionStatus.INCOMINGFILE};
                        if (this.msrpFileProperties) {
                            event.fileProperties = this.msrpFileProperties;
                        }
						this.session.callback.onIncomingFileTransfer(comm, event);
						break;
					case 'imageshare':
						comm = this.session.callback.createImageShare(this.targetAOR[0]);
						comm.getImp().setWrappedCall(this.callback);
						event = {name: SessionStatus.INCOMINGIMAGE};
                        if (this.msrpFileProperties) {
                            event.fileProperties = this.msrpFileProperties;
                        }
						this.session.callback.onIncomingImageShare(comm, event);
						break;
					case 'chat':
						comm = this.session.callback.createChat(this.targetAOR[0]);
						comm.getImp().setWrappedCall(this.callback);
						event = {name: SessionStatus.INCOMINGCHAT};
						this.session.callback.onIncomingChat(comm, event);
						break;
					default:
						if ( this.session.autoAnswerMode )
						{
							this.restoredCall = true;
							this.session.wsRestoreInProgress = false;
							event = {name: SessionStatus.INCOMINGAUTOANSWER};
						}
						else if ( this.session.autoAnswerTimer )
						{
							event = {name: SessionStatus.INCOMINGAUTOANSWER};

							/* Stop the auto-answer timer */
							clearTimeout( this.session.autoAnswerTimer);
							this.session.autoAnswerTimer = false;
							this.session.needAuthOnReRegister = true;
						}
						else
						{
							event = {name: SessionStatus.INCOMINGCALL};
						}
						console.debug( "Sending event = " + event.name );
        					this.session.callback.onIncoming( this.callback, event);
					}

					// ua.sendResponse(ua.createResponse(180, 'Ringing'));
					this.session.adapter.sendResponse(this, 180, 'Ringing');
					this.callStatus = this.CallStatus.RINGING;
					this.callStatusExternal = CallStatus.CONNECTING;
					event = {name: CallStatus.CONNECTING};
					this.callback.onStatus(CallStatus.CONNECTING, event);
				}
			} else {
				console.debug("receivedInvite() received INVITE in state " + this.callStatus);
				this.session.adapter.sendResponse(this, 486, 'Busy Here');
			}

		};

		/**
		* @summary Notifies call is terminated event. Called by adapter
		*/
		this.terminatedCallSessionEvent = function(evt) {
			console.debug("Call.terminatedCallSessionEvent() event: " + evt.name + ", status: " + this.callStatus);
			this.clean();			
			if(evt.name === CallStatus.CANCELED || this.callStatus === this.CallStatus.CANCELING){
				this.callback.onDisconnected({name: CallStatus.CANCELED});
				return;
			}
			if(this.callStatus === this.CallStatus.REFUSED){
				this.callback.onDisconnected({name: CallStatus.REJECTED});
				return;
			}
			this.callStatusExternal = CallStatus.DISCONNECTED;
			this.callStatus = this.CallStatus.CLOSED;
			var event = {name:CallStatus.DISCONNECTED};
			this.callback.onDisconnected(event);
			if ( this.session.ws_only )
			{
				// A ws_only restored call has terminated so
				// use the existing ws to create a register session
				this.session.ws_only = false;	
				this.session.needAuthOnReRegister = false;
				this.session.adapter.createSession();
			}
		};

		/**
		* @summary Notifies call is ringing on remote peer. Called by adapter
		*/
		this.ringingCallSessionEvent = function(evt) {
			console.debug("Call.ringingCallSessionEvent() event: " + evt.name);
			if(this.callStatus === this.CallStatus.IDLE) {
				console.warn('no active call');
				return;
			}
			this.callStatus = this.CallStatus.RINGING;
			this.callStatusExternal = CallStatus.CONNECTING;
		};

		/**
		* @summary Notifies call is answered event. Called by adapter
		*/
		this.acceptedCallSessionEvent = function(evt) {
			var event;
			console.debug("Call.acceptedCallSessionEvent() event: " + evt.name + ", status: " + this.callStatus);
			if (this.callStatus === this.CallStatus.IDLE) {
				console.warn('no active call');
				return;
			}
			if (!this.pc) {
				// failed to get peer-connection
				console.warn("Call.receivedInviteResponse() no peer connection found.");
				this.callStatus = this.CallStatus.IDLE;
				this.callStatusExternal = CallStatus.DISCONNECTED;
				//TODO onStatus() or onError()
				//plugin.settings.onCallStatus.call(this, callParams);
				this.bye();
				return;
			}
			if ((this.callDirection === this.CallDirection.OUTGOING) && ((this.callStatus === this.CallStatus.CALLING) || (this.callStatus === this.CallStatus.RINGING))) {

				if (this.holdPending) {
					this.callStatus = this.CallStatus.HOLD;
					this.callStatusExternal = CallStatus.HOLD;
				} else {
					this.callStatus = this.CallStatus.ACCEPTED;
				}
				var sdp = evt.sdp;
				if (this.pc.remoteStreams !== undefined) {
					remoteStream = this.pc.remoteStreams[0];
					if (remoteStream !== undefined) {
						//-ff this.pc.removeStream(remoteStream);
						console.debug("Call.receivedInviteResponse() remove remote stream (label=)" + remoteStream.label + ")");
					}
				}
				sdp = this.updateSDPForDTLS(sdp, 'incoming');
				sdp = this.updateSDPForTempWorkarounds(sdp, "answer");

				sdp=this.updateMSID(sdp);

				console.trace("receivedInviteResponse() setRemoteDescription sdp = " + sdp);
				this.pc.setRemoteDescription(new RTCSessionDescription({type:'answer', sdp:sdp}),
					this.setRDsuccess,
					this.setRDfailure2);

				this.setMediaTypeFromSdp(sdp); // set mediaTypes when receiving response.

				if (this.holdPending) {
					event = {name: CallStatus.HOLD};
					this.callStatus = this.CallStatus.HOLD;
					this.callStatusExternal = CallStatus.HOLD;
					this.holdPending = false;
					this.callback.onStatus(CallStatus.HOLD, event);
				} else {
					if (this.resumePending) {
						this.resumePending = false;
					}
					this.activeCall = true;
					this.callStatus = this.CallStatus.CONFIRMED;
					if (this.callStatusExternal === CallStatus.HOLD || this.callStatusExternal === CallStatus.REMOTE_HOLD) {
						this.callStatusExternal = CallStatus.CONNECTED;
						event = {name:CallStatus.UNHOLD};
						this.callback.onStatus(CallStatus.UNHOLD, event);
					} else {
						this.callStatusExternal = CallStatus.CONNECTED;
						event = {name:CallStatus.CONNECTED};
						this.callback.onConnected(event);
					}
				}

				if ( this.session.ws_only )
				{
					// A ws_only restored call has been answered.
					// Use the existing ws to create a register session
					this.session.needAuthOnReRegister = true;
					this.session.ws_only = false;	
					var self = this;
					setTimeout( function() { self.session.adapter.createSession(); }, 1000 );
				}

			} else if ((this.callDirection === this.CallDirection.OUTGOING) && (this.callStatus === this.CallStatus.CANCELING)) {
				this.callStatus = this.CallStatus.CANCELED;
			} else {
				console.warn('Unknown state. Stopped! status: ' + this.callStatus + ' direction: ' + this.callDirection);
			}
		};

		/**
		* @summary Notifies call is reject event. Called by adapter
		*/
		this.rejectedCallSessionEvent = function(evt) {
			console.debug("Call.rejectedCallSessionEvent() event: " + evt.name + ", status: " + this.callStatus);
			if (this.callStatus === this.CallStatus.IDLE) {
				console.warn('no active call');
				return;
			}
			if(this.callStatus === this.CallStatus.CANCELED){
				this.callStatusExternal = CallStatus.CANCELED;
				this.callback.onDisconnected({name: CallStatus.CANCELED});
			}
			else{
				this.callStatusExternal = CallStatus.REJECTED;
				this.callback.onDisconnected({name: CallStatus.REJECTED});
			}

			if ( this.session.ws_only )
			{
				// A ws_only restored call has terminated so use
				// the existing ws to create a register session
				this.session.ws_only = false;	
				this.session.adapter.createSession();
			}

			this.clean();
		};

		this.errorCallback = function(error) {
			console.trace(error);
			this.callback.onError(error);
		};

		this.createPeerConnection = function() {
			var constraints = null;
			if (webkitRTCPeerConnection === undefined) {
				console.error('webkitRTCPeerConnection is undefined!');
				return;
			}
			try {
				if (session.config.providerConfig) {
					var s = session.config.providerConfig.stun.replace(/^\s+|\s+$/g, '');
					if (s !== '') {
						this.iceServers = {"iceServers": [{"url": "stun:"+s}]};
					}
					if(session.config.providerConfig.crypto.toLowerCase() === "dtls-srtp") {
						console.debug("Using DTLS-SRTP...") ;
						constraints = {"optional": [{"DtlsSrtpKeyAgreement": true}]} ;
					} else {
						constraints = {"optional": [{"DtlsSrtpKeyAgreement": false}]};
					}
				}
				this.pc = new webkitRTCPeerConnection(this.iceServers, constraints);

				//var self = this;
				this.pc.onaddstream = this.onRTCPeerConnectionOnAddStream;
				this.pc.onconnecting = this.onRTCPeerConnectionOnConnecting;
				//this.pc.ongatheringchange = onRTCPeerConnectionOnGatheringChange;
				this.pc.onicecandidate = this.onRTCPeerConnectionOnIceCandidate;
				//this.pc.onicechange = this.onRTCPeerConnectionOnIceChange;
				this.pc.onnegotiationneeded = this.onRTCPeerConnectionOnNegotiationNeeded;
				this.pc.onopen = this.onRTCPeerConnectionOnOpen;
				this.pc.onremovestream = this.onRTCPeerConnectionOnRemoveStream;
				this.pc.onstatechange = this.onRTCPeerConnectionOnStatusChange;
				console.debug("createPeerConnection() create a RTCPeerConnection instance " + this.pc);
			} catch (exception) {
				console.error("Call() Can not create a RTCPeerConnection instance, exception = " + exception);
			}
		};

		this.createDataChannel = function() {
			//var constraints = {"optional": [{"RtpDataChannels": true}]};
			var constraints = {};
			if (webkitRTCPeerConnection === undefined) {
				console.error('webkitRTCPeerConnection is undefined!');
				return;
			}
			try {
				if (session.config.providerConfig) {
					var s = session.config.providerConfig.stun.replace(/^\s+|\s+$/g, '');
					if (s !== '') {
						this.iceServers = {"iceServers": [{"url": "stun:"+s}]};
					}
					if(session.config.providerConfig.crypto.toLowerCase() === "dtls-srtp") {
						console.debug("Using DTLS-SRTP...") ;
						//TEMP: use RTP datachannel until SCTP is supported in the lab
						//constraints = {"optional": [{"RtpDataChannels": true}, {"DtlsSrtpKeyAgreement": true}]} ;
						constraints = {"optional": [{"DtlsSrtpKeyAgreement": true}]} ;
					} else {
						constraints = {"optional": [{"DtlsSrtpKeyAgreement": false}]};
					}
				}
				this.pc = new webkitRTCPeerConnection(this.iceServers, constraints);

				console.debug('createDataChannel: '+this.callDirection);
				if(false && this.callDirection && this.callDirection ===  this.CallDirection.INCOMING){ //does not work. may remove this block.
					console.debug('createDataChannel ondatachannel: '+this.callDirection);
					this.pc.ondatachannel = this.gotReceiveChannel;
				}
				else{
					console.debug('pc.createDataChannel: '+this.callDirection);
					// Reliable Data Channels not yet supported in Chrome
					//Raju
					//this.dataChannel = this.pc.createDataChannel("orcaDataChannel", {reliable: false});
					this.dataChannel = this.pc.createDataChannel('orcaDataChannel', {reliable: false, negotiated: true});
					this.dataChannel.onopen = this.onDataChannelOnOpen;
					this.dataChannel.onclose = this.onDataChannelOnClose;
					this.dataChannel.onmessage = this.onDataChannelOnMessage;
				}
				//var self = this;
				//this.pc.onaddstream = this.onRTCPeerConnectionOnAddStream;
				//this.pc.onremovestream = this.onRTCPeerConnectionOnRemoveStream;
				this.pc.onconnecting = this.onRTCPeerConnectionOnConnecting;
				this.pc.onicecandidate = this.onRTCPeerConnectionOnIceCandidate;
				//this.pc.onicechange = this.onRTCPeerConnectionOnIceChange;
				this.pc.onnegotiationneeded = this.onRTCPeerConnectionOnNegotiationNeeded;
				this.pc.onopen = this.onRTCPeerConnectionOnOpen;
				this.pc.onstatechange = this.onRTCPeerConnectionOnStatusChange;
				console.debug("createDataChannel() create a RTCPeerConnection data channel " + this.pc + " - " + this.dataChannel);
			} catch (exception) {
				console.error("Call() Can not create a RTCPeerConnection instance or data channel, exception = " + exception);
			}
		};
		
		this.gotReceiveChannel = function(event) {
		  console.debug('Receive Channel Callback');
		  this.dataChannel = event.channel;
		  this.dataChannel.onmessage = this.onDataChannelOnMessage;
		  this.dataChannel.onopen = this.onDataChannelOnOpen;
		  this.dataChannel.onclose = this.onDataChannelOnClose;
		};

		/**
		* Sends text message via data channel. (Orca ALU feature, not in standard Orca.)
		*/
		this.sendMessage = function(msg) {
			if(!this.dataChannel){
				console.warn('data channel not exist!');
				return;
			}
			this.dataChannel.send(msg);
			console.debug('sendMessage(): ' + msg);
		};

	}

	/**
	* @summary Common prototype for Chat, FileTransfer, and ImageShare.
	* @Constructor
    * @memberOf orcaALU
	*/
	function MsrpCommunication(to, file, session, callback) {
		this.to = to;
		this.file = file;
		this.session = session;
		this.callback = callback;
		this.type = 'Unknown';
		this.status = CommStatus.DISCONNECTED;
		this.wasConnected = false;
		this.msrp = null;
		if (this.session && this.session.adapter.Msrp) {
			this.msrp = new this.session.adapter.Msrp(this);
		}
		this.wrappedCall = null;
		
		/**
		* Set the wrappedCall to use
		*/
		this.setWrappedCall = function (call) {
			this.wrappedCall = call;
			if (this.file) {
				this.wrappedCall.getCallImp().msrpFile = this.file;
			}
			if (this.msrp && typeof this.msrp.setWrappedCall === 'function') {
				this.msrp.setWrappedCall(call); // If Msrp needs to prepare the call, let it
			}
		};

		/**
		* Gets the identities of the remote peers attached to this communication
		* @returns {PeerIdentity[]}
		*/
		this.remoteIdentities = function () {
			return [{id: this.to}];
		};

		/**
		* Retrieves the current status of this communication
		* @returns {CommStatus}
		*/
		this.getStatus = function () {
			if (this.wrappedCall) {
				var status = this.wrappedCall.getStatus();
				switch (status) {
				case CallStatus.DISCONNECTED:
					return CommStatus.DISCONNECTED;
				case CallStatus.CONNECTING:
					return CommStatus.CONNECTING;
				case CallStatus.CONNECTED:
					return CommStatus.CONNECTED;
				}
			}
			return this.status;
		};

		/**
		* Attempts to reach the recipient and establish a connection. 
		* For an incoming communication, this method is used to accept it.
		*/
		this.connect = function () {
			if (this.session.adapter.Msrp) {
				if (!this.wasConnected && this.msrp) {
					this.wasConnected = true;
					this.msrp.connect(); // Msrp handles connecting the wrappedCall and attaching callbacks
				}
			} else {
				this.callback.onError(CommError.NOT_SUPPORTED, {name: CommError.NOT_SUPPORTED});
				this.callback.onDisconnected({name: CommStatus.DISCONNECTED});
			}
		};

		/**
		* Ends an active communication.
		*/
		this.disconnect = function () {
			if (this.msrp && typeof this.msrp.disconnect === 'function') {
				this.msrp.disconnect(); // If Msrp wants to manage disconnect, let it
			} else if (this.wrappedCall) {
				this.wrappedCall.disconnect(); // Otherwise, disconnect the call directly
			}
		};

		/**
		* Decline an incoming communication. 
		*/
		this.reject = function () {
			if (this.msrp && typeof this.msrp.reject === 'function') {
				this.msrp.reject(); // If Msrp wants to manage reject, let it
			} else if (this.wrappedCall) {
				this.wrappedCall.disconnect(); // Otherwise, reject the call directly
			}
		};
	}

	/**
	* @summary Provides access to methods for managing an outgoing page mode chat
	* @Constructor
	* @memberOf orcaALU
	*/
	function PageModeChat(to, session, message) {
		this.to = to;
		this.session = session;
		this.message = message;
		this.callId = null;
		this.targetAOR = (typeof to == 'string' ? [to] : to);

        /**
        * Send a textual message to the other page mode chat participant. 
        * @param {string} message The message content to send
        */
		this.sendMessage = function () {
			console.log("sending message: " + this.message + ", targetAOR: " + this.targetAOR);
			this.session.adapter.sendPageModeChatMessage(this, this.targetAOR, this.message);
		};
	}

	/**
	* @summary Provides access to methods for managing an outgoing sms message
	* @Constructor
	* @memberOf orcaALU
	*/
	function SmsMessage(to, session, imdnMessageID, dateTime, message) {
		this.to = to;
		this.session = session;
		this.message = message;
		this.callId = null;
		this.targetAOR = (typeof to == 'string' ? [to] : to);
		this.imdnMessageID = imdnMessageID;
		this.dateTime = dateTime;

        /**
        * Send a textual message to the other sms message participant. 
        * @param {string} message The message content to send
        * @param {string} imdnMessageID The message to send
        */
		this.sendMessage = function () {
			console.log("sending message: " + this.message + ", targetAOR: " + this.targetAOR);
			this.session.adapter.sendSmsMessage(this, this.targetAOR, this.imdnMessageID, this.dateTime, this.message);
		};
	}
	
	/**
	* @summary Provides access to methods for managing an outgoing sms IMDN message
	* @Constructor
	* @memberOf orcaALU
	*/
	function SmsIMDNMessage(to, session, imdnMessageID, status, dateTime) {
		this.to = to;
		this.session = session;
		this.imdnMessageID = imdnMessageID;
		this.callId = null;
		this.targetAOR = (typeof to == 'string' ? [to] : to);
		if (dateTime !== undefined && dateTime !== "") {
			this.dateTime = dateTime;
		} else {
			this.dateTime = ISODateString(new Date());
		}

		this.status = status;

        /**
        * Send a sms imdn message to the other imdn messaage participant. 
        * @param {string} imdnMessageID The message sent
        * @param {string} status The message sent
        */
		this.sendMessage = function () {
			console.log("sending message: imdnMessageID:" + this.imdnMessageID + ", status: " + this.status + ", targetAOR: " + this.targetAOR);
			this.session.adapter.sendSmsIMDNMessage(this, this.targetAOR, this.imdnMessageID, this.status, this.dateTime);
		};
	}
	
		
	function ISODateString(d) {
		function pad(n) {
			return n < 10 ? '0' + n : n
		}
		return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-'
				+ pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':'
				+ pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
	};

	function generateImdnMessageID(n) {
		var chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A',
				'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
				'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
		var randomStr = "";
		var timestamp = new Date().getTime();
		for (var i = 0; i < n; i++) {
			var id = Math.ceil(Math.random() * 35);
			randomStr += chars[id];
		}
		return timestamp + randomStr;
	};

	/**
	* @summary Provides access to methods for managing an outgoing or incoming chat
	* @classdesc Chat objects are obtained by calling the {@Link orca.Session#createChat}
	* method or handling the onIncomingChat event of a connected {@Link orca.Session} instance
	* ({@Link orca.Session#event:onIncomingChat})
	* @Constructor
	* @memberOf orcaALU
	*/
	function Chat(to, session, callback) {
		MsrpCommunication.call(this, to, undefined, session, callback); // Parent constructor
		this.type = 'Chat';

        /**
        * Send a textual message to the other chat participant. 
        * @param {string} message The message content to send
        */
		this.sendMessage = function (message) {
			if (this.msrp) {
				this.msrp.sendMessage(message);
			}
		};
	}
	Chat.prototype = new MsrpCommunication(); // Inherit methods

	/**
	* @summary Provides access to methods for managing an outgoing or incoming file transfer
	* @classdesc FileTransfer objects are obtained by calling the {@Link orca.Session#createFileTransfer}
	* method or handling the onIncomingFileTransfer event of a connected {@Link orca.Session} instance
	* ({@Link orca.Session#event:onIncomingFileTransfer})
	* @Constructor
	* @memberOf orcaALU
	*/
	function FileTransfer(to, file, session, callback) {
		MsrpCommunication.call(this, to, file, session, callback); // Parent constructor
		this.type = 'FileTransfer';
	}
	FileTransfer.prototype = new MsrpCommunication(); // Inherit methods

	/**
	* @summary Provides access to methods for managing an outgoing or incoming image share
	* @classdesc ImageShare objects are obtained by calling the {@Link orca.Session#createImageShare}
	* method or handling the onIncomingImageShare event of a connected {@Link orca.Session} instance
	* ({@Link orca.Session#event:onIncomingImageShare})
	* @Constructor
	* @memberOf orcaALU
	*/
	function ImageShare(to, file, session, callback) {
		MsrpCommunication.call(this, to, file, session, callback); // Parent constructor
		this.type = 'ImageShare';
	}
	ImageShare.prototype = new MsrpCommunication(); // Inherit methods
	// global constants are defined in orca.js



	// Check if the message is the composition indication message from Boghe
	//<?xml version="1.0" encoding="utf-8"?>
	//<isComposing xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="urn:ietf:params:xml:ns:im-iscomposing">
	//  <state>active</state>
	//  <contenttype>text/plain</contenttype>
	//  <refresh>60</refresh>
	//</isComposing>
	function isMessageCompositionIndication(messageString) {
		if (messageString.substr(0, 5) !== "<?xml") {
			return false;
		}
		var parse, xmlDoc;
		if (xmlDoc=document.implementation.createDocument) {
			var parser = new DOMParser()  
			xmlDoc = parser.parseFromString(messageString, "application/xml");
			var element = xmlDoc.firstChild;

			if (element == xmlDoc.lastChild && element.nodeName === "isComposing") {
				//Need the following? Or can return true here? 
				var state, contentType, refresh;
				state = element.getElementsByTagName("state");
				contentType = element.getElementsByTagName("contenttype");
				refresh = element.getElementsByTagName("refresh");
				if (state && contentType && refresh) {
					//console.log("values: " + state.textContent + ", " + contentType.textContent + ", " + refresh.textContent);
					return true;
				}
			}
		} else {
			console.log("Cannot parse xml.");
			return false;
		}
		return false;
	}


    /**
     * @summary Provides access to methods for managing an address book
     * @classdesc AddressBook objects are obtained by calling the {@Link orca.createAddressBook}
     * @Constructor
	 * @param {Userid} userid The user's unique identifier
	 * @param {Token} token An authorization token associated with the provided userid
	 * @param {AbConfig} abConfig AddressBook initialization parameters
     * @memberOf orca
     */
    function AddressBook(userId, token, abConfig, callback) {
		this.callback = callback;

		/**
		 * The user's unique identifier.
		 * @type string
		 * @private
		 */
		this.userId = userId;

		/**
		 * An authorization token associated with the provided userid.
		 * @type {object}
		 * @private
		 */
		this.token = token;

		/**
		 * AddressBook initialization parameters.
		 * @type {AbConfig}
		 * @private
		 */
		this.abConfig = abConfig;
		
		
	    /**
	     * @summary API name of orca.AddressBook
	     * @typedef AddressBookAPI
	     * @type enum
	     */
	    this.AddressBookAPI = {};
	    this.AddressBookAPI.GETLISTIDS = '0';
	    this.AddressBookAPI.GETLISTS = '1';
	    this.AddressBookAPI.GETMEMBERS = '2';
	    this.AddressBookAPI.GETCONTACTS = '3';
	    this.AddressBookAPI.ADDMEMBER = '4';
	    this.AddressBookAPI.ADDCONTACT = '5';
	    this.AddressBookAPI.UPDATEMEMBER = '6';
	    this.AddressBookAPI.UPDATECONTACT = '7';
	    this.AddressBookAPI.DELETELIST = '8';
	    this.AddressBookAPI.DELETEMEMBER = '9';
	    this.AddressBookAPI.DELETECONTACT = '10';
	    this.AddressBookAPI.TRANSFERMEMBER = '11';
		
		/**
		 * @private
		 */
		this.checkConfig = function(){
			if(!abConfig.contactServerURI){
				console.warn("contactServerURI is null");
				return false;
			}
			
			if(!abConfig.baseResourcePath){
				console.warn("baseResourcePath is null");
				return false;
			}
			return true; 
		}
		
		/**
		 * @private
		 */
		this.request = function(url, method, putOrPost, data, cType, accept, api){	
			var self = this;
			try{
			    	self.xmlHttpReq = false; 
			    	// Mozilla/Safari
			    	if (window.XMLHttpRequest) {
			        	self.xmlHttpReq = new XMLHttpRequest();
			    	}
			    	// IE
			    	else if (window.ActiveXObject) {
			        	self.xmlHttpReq = new ActiveXObject("Microsoft.XMLHTTP");
			    	}
			    	else{
			    		try {
			    			xmlhttp = new ActiveXObject("Msxml2.XMLHTTP");
			    		} catch (e) {
			    			console.warn("catch the exception: " + e.toString());
			    		}
			    	}
				  
			       	if(!self.xmlHttpReq){
			    		console.warn("Ajax not supported!");
			     		return;
			    	}
			
			    console.debug("the method is: " + method + ",url is: " + url);
			   	self.xmlHttpReq.open(method, url, true);
			   	self.xmlHttpReq.onreadystatechange = function()
			   	{
			   		
			   		if(!self)
			   			return;
			   		if(!self.xmlHttpReq)
			   			return;
			   		if(!self.xmlHttpReq.readyState)
			   			return;
					if(self.xmlHttpReq.readyState == 4){
					 	var status = self.xmlHttpReq.status;
					 	console.debug("xmlHttpReq.status is: " + status);
					 	if(status == 1223)
					 	   status = 204;
					 	self.onResponse(status,api,accept);
				 	}
				}
				if(accept){
					self.xmlHttpReq.setRequestHeader("Accept", accept);
				}
			    if(putOrPost){
			    	self.xmlHttpReq.setRequestHeader("Content-Type", cType);
			        self.xmlHttpReq.send(data);
			   	}
			   	else {
			   		self.xmlHttpReq.send(null);
			   	}
			      	
		     }catch(e){
		      		console.warn("catch the exception: " + e.toString());
		     }	
		      		
		};
		
	
		/**
		 * @private
		 */
		this.onResponse = function(status, api, accept){
			
			console.debug("status is: " + status + ", api is: " + api + ", accept is: " + accept);
			
			var response = "Response "+  status;
			response += "\n"+this.xmlHttpReq.getAllResponseHeaders(); 
			response += "\n"+this.xmlHttpReq.responseText;   	
		   	console.debug("the response is: " + response);
		   	
		   	var content = this.xmlHttpReq.responseText;
		   	var event;
		   	
	    	if(api === this.AddressBookAPI.GETLISTIDS){
			    if(status >= 200 && status <= 300){
		    		var lists;
		    		if(accept === "application/xml"){
		    			console.debug("parse the response for xml format");
		    			lists = this.parseGetListsForXml(content,true);
		    		}else if (accept === "application/json"){
		    			console.debug("parse the response for json format");
		    		}else{
		    			console.warn("accept error");
		    		}
		    		
		    		event = {name: AddressBookStatus.GETLISTS_SUCCESSFUL};
	                this.callback.onGetLists(lists, event);
			    }else{
			    	event = {name: AddressBookStatus.GETLISTS_FAILED};
			    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				}
	    	}else if(api === this.AddressBookAPI.GETLISTS){
			    if(status >= 200 && status <= 300){
		    		var lists;
		    		if(accept === "application/xml"){
		    			console.debug("parse the response for xml format");
		    			lists = this.parseGetListsForXml(content,false);
		    		}else if (accept === "application/json"){
		    			console.debug("parse the response for json format");
		    		}else{
		    			console.warn("accept error");
		    		}
		    		
		    		event = {name: AddressBookStatus.GETLISTS_SUCCESSFUL};
	                this.callback.onGetLists(lists, event);
			    }else{
			    	event = {name: AddressBookStatus.GETLISTS_FAILED};
			    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				}
	    	}else if(api === this.AddressBookAPI.GETMEMBERS){
				  if(status >= 200 && status <= 300){
			    		var list;		    		
			    		if(accept === "application/xml"){
			    			console.debug("parse the response for xml format");
			    			list = this.parseGetMembersForXml(content);
			    		}else if (accept === "application/json"){
			    			console.debug("parse the response for json format");
			    		}else{
			    			console.warn("accept error");
			    		}
			    		
			    		event = {name: AddressBookStatus.GETMEMBERS_SUCCESSFUL};
		                this.callback.onGetMembers(list, event);
				    }else{
				    	event = {name: AddressBookStatus.GETMEMBERS_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				    }
	    	}else if(api === this.AddressBookAPI.GETCONTACTS){
	    		
	    	}else if(api === this.AddressBookAPI.ADDMEMBER){
				  if(status >= 200 && status <= 300){	
			    		event = {name: AddressBookStatus.ADDMEMBER_SUCCESSFUL};
		                this.callback.onAddMember(event);
				  }else{
				    	event = {name: AddressBookStatus.ADDMEMBER_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				  }
	    	}else if(api === this.AddressBookAPI.ADDCONTACT){
	    		
	    	}else if(api === this.AddressBookAPI.UPDATEMEMBER){
				  if(status >= 200 && status <= 300){			    		
			    		event = {name: AddressBookStatus.UPDATEMEMBER_SUCCESSFUL};
		                this.callback.onUpdateMember(event);
				  }else{
				    	event = {name: AddressBookStatus.UPDATEMEMBER_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				  }
	    	}else if(api === this.AddressBookAPI.UPDATECONTACT){
	    		
	    	}else if(api === this.AddressBookAPI.DELETELIST){
				  if(status >= 200 && status <= 300){			    		
			    		event = {name: AddressBookStatus.DELETELIST_SUCCESSFUL};
		                this.callback.onDeleteList(event);
				  }else{
				    	event = {name: AddressBookStatus.DELETELIST_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				  }
	    	}else if(api === this.AddressBookAPI.DELETEMEMBER){
				  if(status >= 200 && status <= 300){
			    		event = {name: AddressBookStatus.DELETEMEMBER_SUCCESSFUL};
		                this.callback.onDeleteMember(event);
				  }else{
				    	event = {name: AddressBookStatus.DELETEMEMBER_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				  }
	    	}else if(api === this.AddressBookAPI.DELETECONTACT){
	    		
	    	}else if(api === this.AddressBookAPI.TRANSFERMEMBER){
				  if(status >= 200 && status <= 300){			    		
			    		event = {name: AddressBookStatus.TRANSFERMEMBER_SUCCESSFUL};
		                this.callback.onTransferMember(event);
				  }else{
				    	event = {name: AddressBookStatus.TRANSFERMEMBER_FAILED};
				    	this.callback.onError(AddressBookError.NETWORK_ERROR, event);
				  }
	    	}else{ 
	    		console.debug("the api type error");
	    	}

		};
		
		/**
		 * @private
		 */
		this.parseGetListsForXml = function(messageString, getListIds){
			if(!messageString){
				return;
			}
			
			console.debug("messageString is: " + messageString);
			if (messageString.substr(0, 5) !== "<?xml") {
				return;
			}
			
			var parse, xmlDoc;
			var parser = new DOMParser();
			xmlDoc = parser.parseFromString(messageString, "application/xml");
			var lists = new Array();
			if(getListIds){
				console.debug("only return the list Ids");
				var listIdElements = xmlDoc.getElementsByTagNameNS(NS.ab, "listId");
				for (i=0; i<listIdElements.length; i++){
					var list = new Object();
					list.id = listIdElements[i].textContent;
					lists[i] = list;
					console.debug("lists["+ i + "].id is:" + lists[i].id);
				}
			}else{
				console.debug("return list Ids and list members");
				
				var listElements = xmlDoc.getElementsByTagNameNS(NS.ab, "list");
				for (g=0; g<listElements.length; g++){
					var listElementChildNodes = listElements[g].childNodes;
					var list = new Object();
					for(h=0; h<listElementChildNodes.length; h++){
						if(listElementChildNodes[h].nodeName === "ab:listId"){
							list.id = listElementChildNodes[h].textContent;
							console.debug("list.id is:" + list.id);
						}
						if(listElementChildNodes[h].nodeName === "ab:memberCollection"){
							var members = new Array();
							var memberElements = listElementChildNodes[h].getElementsByTagNameNS(NS.ab, "member");
							for (i=0; i<memberElements.length; i++){
								var memberElementChildNodes = memberElements[i].childNodes;
								var member = new Object();
								for(j=0; j<memberElementChildNodes.length; j++){
									if(memberElementChildNodes[j].nodeName === "ab:memberId"){
										member.id = memberElementChildNodes[j].textContent;
										console.debug("member.id is:" + member.id);
									}
									if(memberElementChildNodes[j].nodeName === "ab:attributeList"){
										var attributes = new Array();
										var attributeElements = memberElementChildNodes[j].getElementsByTagNameNS(NS.ab, "attribute");
										
										for(k=0; k<attributeElements.length; k++){
											var attribute = new Object();
											var attributeElementsChildNodes = attributeElements[k].childNodes;
								
											for(l=0; l<attributeElementsChildNodes.length; l++){
												if(attributeElementsChildNodes[l].nodeName === "name"){
													attribute.name = attributeElementsChildNodes[l].textContent;
													console.debug("attribute.name is:" + attribute.name);
												}
												if(attributeElementsChildNodes[l].nodeName === "value"){
													attribute.value = attributeElementsChildNodes[l].textContent;
													console.debug("attribute.name is:" + attribute.value);
												}
											}
											if (attribute.name == 'display-name') {
												member.displayName = attribute.value;
											} 
											attributes[k] = attribute;
										}
										member.attributes = attributes;
									}
								}
							    members[i] = member;
							}
							list.members = members;
						}
					}
					lists[g] = list;
				}
			}
			return lists;
		}
		
		/**
		 * @private
		 */
		this.parseGetMembersForXml = function(messageString){
			if(!messageString){
				return;
			}
			
			console.debug("messageString is: " + messageString);
			if (messageString.substr(0, 5) !== "<?xml") {
				return;
			}
			
			var parse, xmlDoc;
			var parser = new DOMParser();
			xmlDoc = parser.parseFromString(messageString, "application/xml");
			var listIdElements = xmlDoc.getElementsByTagNameNS(NS.ab, "listId");
			var list = new Object();
			list.id = listIdElements[0].textContent;
			console.debug("list.id is:" + list.id);
			
			var members = new Array();
			var memberElements = xmlDoc.getElementsByTagNameNS(NS.ab, "member");
			for (i=0; i<memberElements.length; i++){
				var memberElementChildNodes = memberElements[i].childNodes;
				var member = new Object();
				for(j=0; j<memberElementChildNodes.length; j++){
					if(memberElementChildNodes[j].nodeName === "ab:memberId"){
						member.id = memberElementChildNodes[j].textContent;
						console.debug("member.id is:" + member.id);
					}
					if(memberElementChildNodes[j].nodeName === "ab:attributeList"){
						var attributes = new Array();
						var attributeElements = memberElementChildNodes[j].getElementsByTagNameNS(NS.ab, "attribute");
						
						for(k=0; k<attributeElements.length; k++){
							var attribute = new Object();
							var attributeElementsChildNodes = attributeElements[k].childNodes;
				
							for(l=0; l<attributeElementsChildNodes.length; l++){
								if(attributeElementsChildNodes[l].nodeName === "name"){
									attribute.name = attributeElementsChildNodes[l].textContent;
									console.debug("attribute.name is:" + attribute.name);
								}
								if(attributeElementsChildNodes[l].nodeName === "value"){
									attribute.value = attributeElementsChildNodes[l].textContent;
									console.debug("attribute.name is:" + attribute.value);
								}
							}
							if (attribute.name == 'display-name') {
								member.displayName = attribute.value;
							} 
							attributes[k] = attribute;
						}
						member.attributes = attributes;
					}
				}
			    members[i] = member;
			}
			list.members = members;			
			return list;
		}
		
		
    	/**
    	* Get lists.
    	* @param {boolean} getMembersInList If true, return list IDs and list members.
    	* If false, return list IDs.Default is false.
    	* @returns {List[]}
    	*/
    	this.getLists = function (getMembersInList) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.GETLISTS_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		var formatedUserId = encodeURIComponent(userId);
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists";
    		console.debug("requestURL is: " + requestURL);
    		console.debug("getMembersInList is: " + getMembersInList);
    		if(getMembersInList){
    			this.request(requestURL, "GET", false, null, "application/xml", "application/xml", this.AddressBookAPI.GETLISTS);
    		}else{
    			this.request(requestURL, "GET", false, null, "application/xml", "application/xml", this.AddressBookAPI.GETLISTIDS);
    		}
		    
    	};

    	/**
    	* Get members.
    	* @param {string} listId ID for the list
    	* @returns {List}
    	*/
    	this.getMembers = function (listId) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.GETMEMBERS_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId){
		    	var event = {name: AddressBookStatus.GETMEMBERS_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId;
		    console.debug("requestURL is: " + requestURL);
		    
		    this.request(requestURL, "GET", false, null, "application/xml", "application/xml", this.AddressBookAPI.GETMEMBERS);
    	};


    	/**
    	* Get contacts.
    	* @returns {Contact[]}
    	*/
    	this.getContacts = function () {
    		
    	};


    	/**
    	* Create a list, or add a member in the list. If listId is present 
    	* and member is missing then it creates an empty list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to add
    	*/
    	this.addMember = function (listId, member) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.ADDMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId){
		    	var event = {name: AddressBookStatus.ADDMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var data, requestURL;
    		if(!member){
    			console.debug("member is null, to create list");
        		requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId;
    		    data = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
    			       "<ab:list xmlns:ab=\"urn:oma:xml:rest:netapi:addressbook:1\">" + 
    			       "<listId>" + listId + "</listId>" +
    			       "</ab:list>";
    		}else{
    			console.debug("member is not null, to add member in the list");
        		if(!member || !member.id){
    		    	var event = {name: AddressBookStatus.ADDMEMBER_FAILED};
    		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
        		}
        		var formatedMemberId = encodeURIComponent(member.id);
        		requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId + "/members/" + formatedMemberId;
    		    var attributes = member.attributes;
        		if(!attributes){
        			console.debug("no attributes");
        		    data = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
		       		       "<ab:member xmlns:ab=\"urn:oma:xml:rest:netapi:addressbook:1\">" + 
		                   "<memberId>" + member.id + "</memberId>" + 
		                   "</ab:member>";
        		}else{
        			var attributesStr = "";
        			for(i=0; i<attributes.length; i++){
        				attributesStr += "<attribute>" + 
       				     "<name>" + attributes[i].name + "</name>" + 
       				     "<value>" + attributes[i].value + "</value>" + 
       				     "</attribute>";	
        			}
        			var attributeListStr = "<attributeList>" + 
        			                       attributesStr.trim() + 
        			                       "<resourceURL>" + requestURL + "/attributes" + "</resourceURL>" +
        			                       "</attributeList>";
        		    data = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
  			               "<ab:member xmlns:ab=\"urn:oma:xml:rest:netapi:addressbook:1\">" + 
 			               "<memberId>" + member.id + "</memberId>" + 
 			               attributeListStr +
  			               "</ab:member>";
        		}
    		}
    		
    		console.debug("requestURL is: " + requestURL);
    		console.debug("data is: " + data);		    
		    this.request(requestURL, "PUT", true, data, "application/xml", "application/xml", this.AddressBookAPI.ADDMEMBER);
    	};


    	/**
    	* Create a contact.
    	* @param {Contact} contact Contact to add
    	*/
    	this.addContact = function (contact) {
    		
    	};


    	/**
    	* Update a member in the list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to update
    	*/
    	this.updateMember = function (listId, member) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.UPDATEMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId || !member || !member.id || !member.attributes){
		    	var event = {name: AddressBookStatus.UPDATEMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var formatedMemberId = encodeURIComponent(member.id);
    		
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId + "/members/" + formatedMemberId;
    		console.debug("requestURL is: " + requestURL);
    		
    		var attributes = member.attributes;
			var attributesStr = "";
			for(i=0; i<attributes.length; i++){
				attributesStr += "<attribute>" + 
				     "<name>" + attributes[i].name + "</name>" + 
				     "<value>" + attributes[i].value + "</value>" + 
				     "</attribute>";	
			}
			var attributeListStr = "<attributeList>" + 
			                       attributesStr.trim() + 
			                       "<resourceURL>" + requestURL + "/attributes" + "</resourceURL>" +
			                       "</attributeList>";
		    var data = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
		               "<ab:member xmlns:ab=\"urn:oma:xml:rest:netapi:addressbook:1\">" + 
		               "<memberId>" + member.id + "</memberId>" + 
		               attributeListStr +
		               "</ab:member>";
    		console.debug("data is: " + data);		    
		    
    		this.request(requestURL, "PUT", true, data, "application/xml", "application/xml", this.AddressBookAPI.UPDATEMEMBER);
    	};


    	/**
    	* Update a contact.
    	* @param {Contact} contact Contact to update
    	*/
    	this.updateContact = function (contact) {
    		
    	};

    	/**
    	* Delete the list.
    	* @param {string} listId ID for the list
    	*/
    	this.deleteList = function (listId) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.DELETELIST_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId){
		    	var event = {name: AddressBookStatus.DELETELIST_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId;
		    console.debug("requestURL is: " + requestURL);
		    
		    this.request(requestURL, "DELETE", false, null, "application/xml", "application/xml", this.AddressBookAPI.DELETELIST);
    	};


    	/**
    	* Delete a member in the list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to delete
    	*/
    	this.deleteMember = function (listId, member) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.DELETEMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId){
		    	var event = {name: AddressBookStatus.DELETEMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		if(!member || !member.id){
		    	var event = {name: AddressBookStatus.DELETEMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var formatedMemberId = encodeURIComponent(member.id);
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId + "/members/" + formatedMemberId;
		    console.debug("requestURL is: " + requestURL);

		    this.request(requestURL, "DELETE", false, null, "application/xml", "application/xml", this.AddressBookAPI.DELETEMEMBER);
    	};


    	/**
    	* Delete a contact.
    	* @param {Contact} contact Contact to delete
    	*/
    	this.deleteContact = function (contact) {
    		
    	};


    	/**
    	* Transfer a member to a new list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to move
    	* @param {string} newListId the new list ID to move to
    	*/
    	this.trnsferMember = function (listId, member, newListId) {
    		if(this.checkConfig() === false){
		    	var event = {name: AddressBookStatus.TRANSFERMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.CONFIG_ERROR, event);
		    	return;
    		}
    		if(!listId || !member || !member.id || !newListId){
		    	var event = {name: AddressBookStatus.TRANSFERMEMBER_FAILED};
		    	this.callback.onError(AddressBookError.PARAMETERS_ERROR, event);
		    	return;
    		}
    		
    		var formatedUserId = encodeURIComponent(userId);
    		var formatedListId = encodeURIComponent(listId);
    		var formatedMemberId = encodeURIComponent(member.id);
    		
    		var requestURL = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + formatedUserId + "/lists/" + formatedListId + "/members/" + formatedMemberId + "/transfer";
    		console.debug("requestURL is: " + requestURL);
    		
    		var destinationStr = abConfig.contactServerURI + "/" + abConfig.baseResourcePath + "/addressbook/v1/" + userId + "/lists/" + newListId;
    		console.debug("destinationStr is: " + destinationStr);
    		
    		var data = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
                       "<ab:memberTransferParameters xmlns:ab=\"urn:oma:xml:rest:netapi:addressbook:1\">" + 
                       "<destination>" + destinationStr + "</destination>" +
                       "</ab:memberTransferParameters>";
    		console.debug("data is: " + data);
    		
		    this.request(requestURL, "POST", true, data, "application/xml", "application/xml", this.AddressBookAPI.TRANSFERMEMBER);
    	};		
		
   	}
	
	/**
	* @summary root namespace of the call control SDK
	* @global
	* @namespace
	*/
	var orcaALU = {
		/**
		* allow creation of multiple sessions in a single page;
		* possibly limit repeated registrations using the same identity
		* @param {Userid} userid The user's unique identifier
		* @param {Token} token An authorization token associated with the provided userid
		* @param {SessionConfig} sessionConfig session initialization parameters
		* @returns {orca.Session}
		*/
		createSession: function (userid, token, sessionConfig, callback) {
			var config = {
				uri: sessionConfig.uri,
				mediatypes: sessionConfig.mediatypes || 'audio',
				providerConfig: {}
			};
			var fields = [
				'interfaceType', 'sendAuthOnInitReg', 'sendAuthOnReregDereg', 'reUseCallidInReregDereg',
				'stun', 'bundle', 'crypto', 'conferenceFactoryURI',
				'expires', 'addCodecs', 'dtmf', 'dtmfDuration', 'dtmfGap',
				'audioBandwidth', 'videoBandwidth', 'dataBandwidth', 'audioCodecs', 'videoCodecs',
				'persistentPC', 'breaker', 'stripExtraSSRC', 'confWorkaroundChrome', 'useFirstCandidate',
				'removeIPV6Candidates', 'enableIMDNCapability', 'autoAnswerTime', 'maxRecoveryAttempts', 'networkRetryInterval', 'sendRegisterOnRecovery',
				'registerResponseTime', 'registerRefreshTime', 'msidHandling', 'crlfKeepAliveInterval', 'enableMDSPsupport',
				'secondaryDeviceId', 'dtmfWorkaround'
			];
			var values = [
				'SIP-WS', false, true, true,
				'', false, 'dtls-srtp', '',
				'600', true, 'inband', '100', '70',
				'', '', '', '', '',
				true, false, true, false, false,
				true, true, 0, 5, 5, false,
				0, 0, '1', 0, false,
				'mobility="fixed"', true
			];

			for (var i=0; i < fields.length; i++) {
				if (sessionConfig.providerConfig && sessionConfig.providerConfig[fields[i]] !== undefined) {
					config.providerConfig[fields[i]] = sessionConfig.providerConfig[fields[i]];
				} else {
					config.providerConfig[fields[i]] = values[i];
				}
			}
			return new Session(userid, token, config, callback);
		},
		
        /**
         * Create a new addressbook instance for a user. 
         * @param {userid} userid The user's unique identifier. In Orca ALU, this is the user's
         * public ID.
         * @param {token} token An authorization token associated with the provided userid
         * @param {AbConfig} abConfig AddressBook initialization parameters
         * @returns {orca.AddressBook}
         */
        createAddressBook: function (userid, token, abConfig, callback) {
             return new AddressBook(userid, token, abConfig, callback);
        }

		// orca.createManagedStream() is implemented in orca.js

	};

	this.orcaALU = orcaALU;

})();

