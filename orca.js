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

/* $Id: orca.js 412 2014-09-29 07:56:20Z wenwenzh $ */
/*jslint browser: true, sloppy: true, undef: true */

(function () {
    var orca, SessionStatus, SessionError, CallStatus, CallError, AddressBookStatus, AddressBookError;

    /**
    * @summary Provides access to media control functions during a call
    * @classdesc ManagedStream objects are obtained by calling the
    * {@Link orca.createManagedStream} method or handling the onAddStream event of a
    * {@Link orca.Call} ({@Link orca.Call#event:onAddStream}). They are also created
    * implicitly when passing a raw RTCMediaStream to the {@Link orca.Call#addStream} method.
    * @constructor
    * @memberOf orca
    * @param {RTCMediaStream} rtcMediaStream the underlying WebRTC runtime MediaStream instance  
    */
    function ManagedStream(rtcMediaStream) {

        /**
        * @summary Gets the types of media associated with this instance as a comma-separated
        * list, e.g. "audio,video"
        * @returns {string}
        */
        this.type = function () {
            var a = rtcMediaStream.getAudioTracks().length > 0,
                v = rtcMediaStream.getVideoTracks().length > 0;
            if (a) {
                if (v) {
                    return 'audio,video';
                }
                return 'audio';
            }
            if (v) {
                return 'video';
            }
            return '';
        };

        /**
        * @summary Restarts transmission of the media content after it has been stopped
        */
        this.resume = function () {
            setTrackListEnabled(rtcMediaStream.getAudioTracks(), true);
            setTrackListEnabled(rtcMediaStream.getVideoTracks(), true);
        };

        /**
        * @summary Halts transmission of the media content during a call
        * 
        */
        this.stop = function () {
            setTrackListEnabled(rtcMediaStream.getAudioTracks(), false);
            setTrackListEnabled(rtcMediaStream.getVideoTracks(), false);
        };

        /**
        * Gets the underlying WebRTC MediaStream
        * @returns {RTCMediaStream}
        */
        this.stream = function () {
            return rtcMediaStream;
        };
    }

    /** 
    *
    * @classdesc Session objects are obtained by calling the {@Link orca.createSession} method
    * @summary Manages communications for a given user identity
    * @constructor
    * @memberOf orca
    */
    function Session(userid, token, sessionConfig) {
        var sessionImp = sessionConfig.provider.createSession(userid, token, sessionConfig, this);

        /**
        * Activates the communications session with a gateway server. In Orca ALU, this sends a
        * SIP REGISTER request.
        * @method
        */
        this.connect = function () {
            return sessionImp.connect();
        };

        /**
        * Creates a new call instance for communication with the specified recipient
        * @param {string} to the user identifier of the call recipient. In Orca ALU, this is the
        * user's public ID.
        * @param {string} mediatypes Comma-separated list of media stream types to be used during
        * the call e.g. "audio,video".
        */
        this.createCall = function (to, mediatypes) {
            return new Call(to, mediatypes, sessionImp);
        };

        /**
        * Creates a new Chat instance for communication with the specified recipient
        * @param {string} to The user identifier of the chat invitee. In Orca ALU, this is the
        * user's public ID.
        */
        this.createChat = function (to) {
            return new Chat(to, sessionImp);
        };

        /**
        * Creates a new FileTransfer instance to send a file to the specified recipient
        * @param {string} to The user identifier of the file recipient. In Orca ALU, this is the
        * user's public ID.
        * @param {File|Blob} file The file to send
        */
        this.createFileTransfer = function (to, file) {
            return new FileTransfer(to, file, sessionImp);
        };

        /**
        * Creates a new ImageShare instance to send an image file to the specified recipient
        * @param {string} to The user identifier of the image recipient. In Orca ALU, this is the
        * user's public ID.
        * @param {File|Blob} file The image file to send
        */
        this.createImageShare = function (to, file) {
            return new ImageShare(to, file, sessionImp);
        };
        /**
        * Ends and active communications session with a gateway server. In Orca ALU, this does an
        * unregister.
        */
        this.disconnect = function () {
            return sessionImp.disconnect();
        };

        /**
        * @summary Retrieves the current status of this session
        * @returns {SessionStatus}
        */
        this.getStatus = function () {
            return sessionImp.getStatus();
        };

        /**
        * Sends a page mode message to a remote party 
        * @param {string} to The user identifier of the chat invitee
        * @param {string} message The message to be sent
        */
        this.sendPageModeChatMessage = function (to, message) {
            return sessionImp.sendPageModeChatMessage(to, message);
        };
        
        /**
        * Sends a sms message to a remote party 
        * @param {string} to The user identifier of the chat invitee
        * @param {string} message The message to be sent
        * @param {Object} smsIMDNMessageInfo Message attributes
        * @returns {string} imdnMessageID to application
        */
        this.sendSmsMessage = function (to, message, smsIMDNMessageInfo) {
            return sessionImp.sendSmsMessage(to, message, smsIMDNMessageInfo);
        };
        
        /**
        * Sends a sms IMDN message to a remote party 
        * @param {string} to The user identifier of the chat invitee
        * @param {string} imdnMessageID of sms message sent
        * @param {string} status of sms message sent
        * @param {string} dateTime of sms message sent
        */
        this.sendSmsIMDNMessage = function (to, imdnMessageID, status, dateTime) {
            return sessionImp.sendSmsIMDNMessage(to, imdnMessageID, status, dateTime);
        };

        /**
         * Subscribe to current and future presence updates of a presentity 
         * or presentities in a presence list.
         * 
         * @param {string} presenceResource A presentity or a presence list
         */
         this.subscribePresence = function (presenceResource) {
        	    return sessionImp.subscribePresence(presenceResource);
         };

          
         /**
         * Request current presence information of a presentity or 
         * presentites of a presence list. getPresence() will also
         * terminate the former subscription made on the same presence
         * resource by the watcher
         * 
         * @param {string} presenceResource A presentity or a presence list
         */
         this.getPresence = function (presenceResource) {
        	    return sessionImp.getPresence(presenceResource);
         };
           
         /**
         * Update own presence information for others to see.
         * @param {string} presenceInfo pidf XML or pidf-diff XML
         * that are defined by RFC 3386, 5263, 5196, 4480
         */
         this.updatePresence = function (presenceInfo) {
             return sessionImp.updatePresence(presenceInfo);
         };
         
         this.test = function(testString) {
         	return sessionImp.test(testString);
         }
         
        /**
        * @summary Triggered when the session is connected successfully
        * @event
        * @param {Event} event event data
        */
        this.onConnected = function (event) {
        };

        /**
        * @summary Triggered when the session is disconnected
        * @event
        * @param {Event} event event data
        *
        */
        this.onDisconnected = function (event) {
        };

        /**
        * @Summary Triggered when an error condition occurs
        * @event
        * @param {SessionError} status Indicates the error that caused the event
        * @param {Event} event event data
        */
        this.onError = function (error, event) {
        };

        /**
        * Triggered when an incoming call is received during an active session
        * @event
        * @param {orca.Call} receivedCall incoming call object
        * @param {Event} event event data
        */
        this.onIncoming = function (receivedCall, event) {
        };

        /**
        * Triggered when an incoming chat is received during an active session
        * @event
        * @param {orca.Chat} chat incoming chat object
        * @param {Event} event event data
        */
        this.onIncomingChat = function (chat, event) {
        };

        /**
        * Triggered when an incoming page mode chat message is received
        * @event
        * @param {orca.PageModeChat} pageModeChat incoming pageModeChat object
        * @param {Event} event event data
        */
        this.onIncomingPageModeChat = function (event) {
        };

        /**
        * Triggered when an page mode chat message is sent out
        * @event
        * @param {message} the pageModeChat message that is sent
        * @param {Event} event event data
        */
        this.onPageModeChatMessageSent = function (message, event) {
        };

        /**
        * Triggered when an page mode chat message fails to be sent out
        * @event
        * @param {message} the pageModeChat message that is sent
        * @param {Event} event event data
        */
        this.onPageModeChatMessageFailed = function (message, event) {
        };
        
        /**
        * Triggered when an incoming sms message is received
        * @event
        * @param {orca.SmsMessage} smsMessage incoming smsMessage object
        * @param {Event} event event data
        */
        this.onIncomingSmsMessage = function (event) {
        };

        /**
        * Triggered when a sms message is sent out
        * @event
        * @param {message} the sms message that is sent
        * @param {Event} event event data
        */
        this.onSmsMessageSent = function (message, event) {
        };

        /**
        * Triggered when a sms message fails to be sent out
        * @event
        * @param {message} the sms message that is sent
        * @param {Event} event event data
        */
        this.onSmsMessageFailed = function (message, event) {
        };
        
        /**
        * Triggered when an incoming sms IMDN message is received
        * @event
        * @param {Event} event event data with properties message-id, datetime, status
        */
        this.onIncomingSmsIMDNMessage = function (event) {
        };

        /**
        * Triggered when an IMDN message is sent out
        * @event
        * @param {Event} event event data
        */
        this.onSmsIMDNMessageSent = function (event) {
        };

        /**
        * Triggered when an IMDN message fails to be sent out
        * @event
        * @param {Event} event event data
        */
        this.onSmsIMDNMessageFailed = function (event) {
        };


        /**
        * Triggered when an incoming file transfer is received during an active session
        * @event
        * @param {orca.Chat} fileTransfer incoming file transfer object
        * @param {Event} event event data
        */
        this.onIncomingFileTransfer = function (fileTransfer, event) {
        };

        /**
        * Triggered when an incoming image share is received during an active session
        * @event
        * @param {orca.Chat} imageShare incoming image share object
        * @param {Event} event event data
        */
        this.onIncomingImageShare = function (imageShare, event) {
        };

        /**
         * Triggered when presence information is received.
         * This is a callback function that needs to be implemented 
         * in application layer
         * 
         * @param {String} presenceInfo The body of NOTIFY message that contains the 
         * information for subscribed presentity(ies).
         * @param {Event} event event data containing the NOTIFY message header information
         * including: event.from, event.to, event.callId, event.cSeq, event.subscriptionState,
         * event.contentLength, event.contentType, event.type, event.boundary.
         */
         this.onPresenceNotify = function (presenceInfo, event) {
         };

         /**
          * Triggered when successfully subscribe presence 
          * This is a callback function that needs to be implemented 
          * in application layer
          * 
          * @param {Event} event event data
          */
          this.onSubscribePresenceSuccess = function (event) {
          };

         /**
         * Triggered when subscription to presence fails. 
         * This is a callback function that needs to be implemented 
         * in application layer
         * 
         * @param {Event} event event data
         */
         this.onSubscribePresenceFailed = function (event) {
         };

         /**
          * Triggered when successfully unSubscribe presence 
          * This is a callback function that needs to be implemented 
          * in application layer
          * 
          * @param {Event} event event data
          */
          this.onGetPresenceSuccess = function (event) {
          };

          /**
         * Triggered when get presence fails. 
         * This is a callback function that needs to be implemented 
         * in application layer
         * 
         * @param {Event} event event data
         */
         this.onGetPresenceFailed = function (event) {
         };

         /**
         * Triggered when successfully updated presence
         * @event
         * @param {Event} event event data
         */
         this.onUpdatePresenceSuccess = function (event) {
         };

         /**
         * Triggered when failed to update presence
         * @event
         * @param {Event} event event data
         */
         this.onUpdatePresenceFail = function (event) {
         };
          
        /**
        *  Returns the MDSP (Multiple Devices Shared PUID) contact information associated
	*  with other device sharing the user's PUID.
        */
	this.getMDSPinfo = function() {
		return sessionImp.mdsp.getContacts();
	};

        /**
	* Pull a call from a shared PUID contact.
        * Triggered when the user wishes to pull a call from a shared PUID contact.
        * @param {orca.Call} call Outgoing call object
        * @param {callInfo} callInfo Holds gruu and dialog associated with the call to be 'pulled'.
        */
	this.pullCallFromMDSPdialog = function( call, callInfo) {
		sessionImp.mdsp.pullCallFromMDSPdialog( call, callInfo);
	};

	/*
         *  Triggered when MDSP Information is updated.
         *  This is a callback function that needs to be implemented 
         *  in application layer
         */
	this.onMDSPinfoUpdate = function() {
	};

        /**
        * @summary Triggered when a change in the call state occurs
        * Examples of changes in call state are: Hold (call is placed on hold), Unhold (call is
        * taken off hold)
        * @event
        * @param {SessionStatus} status Indicates the state that triggered the event
        * @param {Event} event event data
        */
        this.onStatus = function (status, event) {
        };
        
	/**
	* @summary Update token.key and refresh session
	*/
	this.updateToken = function (tokenKey) {
		 return sessionImp.updateToken(tokenKey);
	};
		/**
		* @summary send ping frame
		*/
		this.sendPingFrame = function () {
			return sessionImp.sendPingFrame();
		}
    }



    /**
    * @summary Provides access to methods for managing an outgoing or incoming call
    * @classdesc Calls objects are obtained by calling the {@Link orca.Session#createCall}
    * method or handling the onIncoming event of a connected {@Link orca.Session} instance
    * ({@Link orca.Session#event:onIncoming})
    * @Constructor
    * @memberOf orca
    */
    function Call(to, mediatypes, sessionImp) {
        var callImp = sessionImp.createCall(to, mediatypes, sessionImp, this),
            id = generateCallId(),
            localStreams = [];

        /**
        * Gets a unique identifier for the call 
        * @type {string}
        */
        this.id = function () {
            return id;
        };

        /**
        * Gets the identities of the remote peers attached to this call
        * @returns {PeerIdentity[]}
        */
        this.remoteIdentities = function () {
            return callImp.remoteIdentities();
        };

        this.getpc = function () {
            return callImp.getpc();
        };

        this.dumpCallInfo = function () {
            return callImp.dumpCallInfo();
        };

        /**
        * Adds a local media stream to the call. 
        * Media stream instances are obtained from the browser's getUserMedia() method.
        * Local media streams should be added using this method before the connect method 
        * is called to either initiate a new call or answer a received call. 
        * If a RTCMediaStream is passed to this function, it will be converted to a ManagedStream.
        * In Orca ALU, this method may be used during an active call to replace the outgoing media 
        * stream with a new one, allowing an upgrade from an audio to a video call for example.
        * @param {(orca.ManagedStream|RTCMediaStream)} stream local media stream
        * @returns {orca.ManagedStream}
        */
        this.addStream = function (stream) {
            var managed = stream;
            if (stream !== null) {
                if (stream.constructor.name !== 'ManagedStream') {
                    managed = orca.createManagedStream(stream);
                }
                localStreams.push(managed);
                if (typeof callImp.addStream === 'function') {
                    callImp.addStream(managed);
                }
                return managed;
            }
        };

        /**
        * @private
        */
        this.removeStream = function (stream) {
            var managed = stream;
            if (stream !== null) {
                if (typeof callImp.removeStream === 'function') {
                    callImp.removeStream(managed);
                }
                localStreams.shift();
            }
        };

        /**
        * Attempts to reach the call recipient and establish a connection. 
        * For an incoming call, calling this method explicitly joins/accepts the call.
        */
        this.connect = function () {
            return callImp.connect();
        };

        /**
        * Ends an active call.
        */
        this.disconnect = function () {
            return callImp.disconnect();
        };

        /**
        * Called when a user does not wish to accept an incoming call. 
        */
        this.reject = function () {
            return callImp.reject();
        };

        /**
        * Retrieves a list of streams associated with this call.
        * The return value is an array of ManagedStream instances with undefined order
        * When no selector parameter is provided all local and remote streams are included
        * in the returned array.
        * The keywords *local* and *remote* can be specified to limit the results to local or 
        * remote streams respectively.
        * The *.* (period) symbol is used to prefix a keyword used to limit the results by the
        * stream type.  E.g. ".video" would be used to return a list of streams with video tracks.
        * The *#* (pound) symbol is used to prefix label text used to limit the results to a 
        * to a single stream with a label matching the specified text.
        * 
        * @param {string} selector optional query to filter the result list
        * @returns {orca.ManagedStream[]}
        * @example
        * // Get list of all local streams
        * var localStreams = call.streams("local");
        *
        * // Get list of all audio streams
        * var audioStreams = call.streams(".audio");
        * 
        * // Get stream with by its label name
        * // If successful only one match should be
        * // returned
        * var stream0 = call.streams("#stream_0");
        * if (stream0 && stream0.length == 1) {
        * ...
        * }
        * 
        * // Possible to support combined selections?
        * // Get list of local audio streams
        * var localAudio = call.streams("local.audio");
        */
        this.streams = function (selector) {
            var result = [], el = '', id = '', audio = false, video = false;
            if (selector && typeof selector === 'string') {
                el = selector.match(/^[0-9a-zA-Z]*/)[0].toLowerCase();
                id = selector.match(/#[0-9a-zA-Z]*/);
                if (id) {
                    id = id[0].substring(1);
                } else {
                    id = '';
                }
                audio = selector.match(/\.audio([#.\s]|$)/) ? true : false;
                video = selector.match(/\.video([#.\s]|$)/) ? true : false;
            }
            if (el !== 'local') {
                selectStreams(callImp.remoteStreams(), result, id, audio, video);
            }
            if (el !== 'remote') {
                selectStreams(localStreams, result, id, audio, video);
            }
            return result;
        };

        /**
        * Retrieves the current status of this call
        * @returns {CallStatus}
        */
        this.getStatus = function () {
            return callImp.getStatus();
        };

        /**
        * Gets the media stream types used in this call as a comma-separated list, e.g.
        * "audio,video". (Orca ALU feature, not in standard Orca.)
        * @returns {string}
        */
        this.getMediaTypes = function () {
            return callImp.getMediaTypes();
        };

        /**
        * Add a new participant to a group call of which you are the initiator. (Orca ALU
        * feature, not in standard Orca.)
        * @param {string} target The user to add
        */
        this.addParticipant = function (target) {
            return callImp.addParticipant(target);
        };

        /**
        * Remove a participant from a group call of which you are the initiator. (Orca ALU
        * feature, not in standard Orca.)
        * @param {string} target The user to remove
        */
        this.removeParticipant = function (target) {
            return callImp.removeParticipant(target);
        };

        /**
        * Send DTMF. (Orca ALU feature, not in standard Orca.)
        * @param {string} dtmf The DTMF to send
        */
        this.sendDTMF = function (dtmf) {
            return callImp.sendDTMF(dtmf);
        };

        /**
        * Blind transfer a call via SIP REFER request. (Orca ALU feature, not in standard Orca.)
        * @param {string} target the user identifier to transfer the call to
        */
        this.transfer = function (target) {
            return callImp.transfer(target);
        };

        /**
         *  Locally mute audio and/or video. (Orca ALU feature, not in standard Orca.)
         */
        this.mute = function (media_types) {
            var streams = this.streams('local'), i;
            if (media_types === undefined) {
                // no argument provided so mute both
                for (i = 0; i < streams.length; i += 1) {
                    streams[i].stop();
                }
                return;
            }
            if (media_types.indexOf('audio') >= 0) {
                // Muting audio
                for (i = 0; i < streams.length; i += 1) {
                    setTrackListEnabled(streams[i].stream().getAudioTracks(), false);
                }
            }
            if (media_types.indexOf('video') >= 0) {
                // Muting video
                for (i = 0; i < streams.length; i += 1) {
                    setTrackListEnabled(streams[i].stream().getVideoTracks(), false);
                }
            }
        };

        /**
         *  Locally un-mute audio and/or video. (Orca ALU feature, not in standard Orca.)
         */
        this.unmute = function (media_types) {
            var streams = this.streams('local'), i;
            if (media_types === undefined) {
                // no argument provided so mute both
                for (i = 0; i < streams.length; i += 1) {
                    streams[i].resume();
                }
                return;
            }
            if (media_types.indexOf('audio') >= 0) {
                // Un-Muting audio
                for (i = 0; i < streams.length; i += 1) {
                    setTrackListEnabled(streams[i].stream().getAudioTracks(), true);
                }
            }
            if (media_types.indexOf('video') >= 0) {
                // Un-Muting video
                for (i = 0; i < streams.length; i += 1) {
                    setTrackListEnabled(streams[i].stream().getVideoTracks(), true);
                }

            }
        };

        /**
        * Places a call on hold. (Orca ALU feature, not in standard Orca.)
        */
        this.hold = function (type) {
            callImp.hold(type);
        };

        /**
        * Takes a call off hold. (Orca ALU feature, not in standard Orca.)
        */
        this.resume = function () {
            callImp.resume();
        };

        /**
        * Create data channel. (Orca ALU feature, not in standard Orca.)
        */
        this.createDataChannel = function () {
            callImp.createDataChannel();
        };

        /**
        * Sends text message via data channel. (Orca ALU feature, not in standard Orca.)
        */
        this.sendMessage = function (msg) {
            callImp.sendMessage(msg);
        };

        /**
        * Sends binary file via data channel. (Orca ALU feature, not in standard Orca.)
        */
        this.sendFile = function (url) {
            callImp.sendFile(url);
        };

        /**
        * @summary Triggered when a remote stream is added to the call
        * @event
        * @param {orca.ManagedStream} stream remote media stream
        * @param {Event} event event data
        */
        this.onAddStream = function (stream, event) {
        };

        /**
        * @summary Triggered when a call is connected
        * @event
        * @param {Event} event event data
        */
        this.onConnected = function (event) {
        };

        /**
        * @summary Triggered when a call is disconnected
        * @event
        * @param {Event} event event data
        */
        this.onDisconnected = function (event) {
        };

        /**
        * @summary Triggered when an error condition occurs
        * @event
        * @param {CallError} status Indicates the error that caused the event
        * @param {Event} event event data
        */
        this.onError = function (error, event) {
        };

        /**
        * Triggered when a change in the session state occurs
        * @event
        * @param {CallStatus} status Indicates the state that caused the event
        * @param {Event} event event data
        */
        this.onStatus = function (status, event) {
        };

        /**
        * Triggered when a change in the session state occurs
        * @event
        * @param {Event} event event data
        */
        this.onMessage = function (event) {
        };

	/**
	* Push a call to a shared PUID contact.
	* @param {string} pushToGruu Holds gruu associated with contact to which the call will be 'pushed'.
	*/
	this.pushCallToMDSPcontact = function( pushToGruu) {
		sessionImp.mdsp.pushCallToContact( callImp, pushToGruu);
	};

	/**
	* @private
	*/
        this.getCallImp = function() {
            return callImp;
        };
    }



    /**
    * @summary Provides access to methods for managing an outgoing or incoming chat
    * @classdesc Chat objects are obtained by calling the {@Link orca.Session#createChat}
    * method or handling the onIncomingChat event of a connected {@Link orca.Session} instance
    * ({@Link orca.Session#event:onIncomingChat})
    * @Constructor
    * @memberOf orca
    */
    function Chat(to, sessionImp) {
        var chatImp = sessionImp.createChat(to, sessionImp, this),
            id = generateCallId();

		/**
		* @private
		*/
        this.getImp = function() {
            return chatImp;
        };

        /**
        * Gets a unique identifier for the communication 
        * @type {string}
        */
        this.id = function () {
            return id;
        };

        /**
        * Gets the identities of the remote peers attached to this communication
        * @returns {PeerIdentity[]}
        */
        this.remoteIdentities = function () {
            return chatImp.remoteIdentities();
        };

        /**
        * Retrieves the current status of this communication
        * @returns {CommStatus}
        */
        this.getStatus = function () {
            return chatImp.getStatus();
        };

        /**
        * Attempts to reach the recipient and establish a connection. 
        * For an incoming communication, this method is used to accept it.
        */
        this.connect = function () {
            return chatImp.connect();
        };

        /**
        * Ends an active communication.
        */
        this.disconnect = function () {
            return chatImp.disconnect();
        };

        /**
        * Decline an incoming communication. 
        */
        this.reject = function () {
            return chatImp.reject();
        };

        /**
        * Send a textual message to the other chat participant. 
        * @param {string} message The message content to send
        */
        this.sendMessage = function (message) {
            return chatImp.sendMessage(message);
        };

        /**
        * @summary Triggered when the communication is connected
        * @event
        * @param {Event} event event data
        */
        this.onConnected = function (event) {
        };

        /**
        * @summary Triggered when the communication is disconnected
        * @event
        * @param {Event} event event data
        */
        this.onDisconnected = function (event) {
        };

        /**
        * @summary Triggered when an error condition occurs
        * @event
        * @param {CommError} status Indicates the error that caused the event
        * @param {Event} event event data
        */
        this.onError = function (error, event) {
        };

        /**
        * Triggered when a change in the session state occurs
        * @event
        * @param {CommStatus} status Indicates the state that caused the event
        * @param {Event} event event data
        */
        this.onStatus = function (status, event) {
        };

        /**
        * Triggered when a textual message is received from the other chat participant
        * @event
        * @param {string} message The message content that was received
        * @param {Event} event event data
        */
        this.onReceived = function (message, event) {
        };

    }



    /**
    * @summary Provides access to methods for managing an outgoing or incoming file transfer
    * @classdesc FileTransfer objects are obtained by calling the {@Link orca.Session#createFileTransfer}
    * method or handling the onIncomingFileTransfer event of a connected {@Link orca.Session} instance
    * ({@Link orca.Session#event:onIncomingFileTransfer})
    * @Constructor
    * @memberOf orca
    */
    function FileTransfer(to, file, sessionImp) {
        var fileTransferImp = sessionImp.createFileTransfer(to, file, sessionImp, this),
            id = generateCallId();

		/**
		* @private
		*/
        this.getImp = function() {
            return fileTransferImp;
        };

        /**
        * Gets a unique identifier for the communication 
        * @type {string}
        */
        this.id = function () {
            return id;
        };

        /**
        * Gets the identities of the remote peers attached to this communication
        * @returns {PeerIdentity[]}
        */
        this.remoteIdentities = function () {
            return fileTransferImp.remoteIdentities();
        };

        /**
        * Retrieves the current status of this communication
        * @returns {CommStatus}
        */
        this.getStatus = function () {
            return fileTransferImp.getStatus();
        };

        /**
        * Attempts to reach the recipient and establish a connection. 
        * For an incoming communication, this method is used to accept it.
        */
        this.connect = function () {
            return fileTransferImp.connect();
        };

        /**
        * Ends an active communication.
        */
        this.disconnect = function () {
            return fileTransferImp.disconnect();
        };

        /**
        * Decline an incoming communication. 
        */
        this.reject = function () {
            return fileTransferImp.reject();
        };

        /**
        * @summary Triggered when the communication is connected
        * @event
        * @param {Event} event event data
        */
        this.onConnected = function (event) {
        };

        /**
        * @summary Triggered when the communication is disconnected
        * @event
        * @param {Event} event event data
        */
        this.onDisconnected = function (event) {
        };

        /**
        * @summary Triggered when an error condition occurs
        * @event
        * @param {CommError} status Indicates the error that caused the event
        * @param {Event} event event data
        */
        this.onError = function (error, event) {
        };

        /**
        * Triggered when a change in the session state occurs
        * @event
        * @param {CommStatus} status Indicates the state that caused the event
        * @param {Event} event event data
        */
        this.onStatus = function (status, event) {
        };

        /**
        * Triggered when the complete file is received from the other party. Only the recipient will get this event.
        * @event
        * @param {Blob} message The file that was received
        * @param {Event} event event data
        */
        this.onReceived = function (message) {
        };

    }



    /**
    * @summary Provides access to methods for managing an outgoing or incoming image share
    * @classdesc ImageShare objects are obtained by calling the {@Link orca.Session#createFileTransfer}
    * method or handling the onIncomingImageShare event of a connected {@Link orca.Session} instance
    * ({@Link orca.Session#event:onIncomingImageShare})
    * @Constructor
    * @memberOf orca
    */
    function ImageShare(to, file, sessionImp) {
        var imageShareImp = sessionImp.createImageShare(to, file, sessionImp, this),
            id = generateCallId();

		/**
		* @private
		*/
        this.getImp = function() {
            return imageShareImp;
        };

        /**
        * Gets a unique identifier for the communication 
        * @type {string}
        */
        this.id = function () {
            return id;
        };

        /**
        * Gets the identities of the remote peers attached to this communication
        * @returns {PeerIdentity[]}
        */
        this.remoteIdentities = function () {
            return imageShareImp.remoteIdentities();
        };

        /**
        * Retrieves the current status of this communication
        * @returns {CommStatus}
        */
        this.getStatus = function () {
            return imageShareImp.getStatus();
        };

        /**
        * Attempts to reach the recipient and establish a connection. 
        * For an incoming communication, this method is used to accept it.
        */
        this.connect = function () {
            return imageShareImp.connect();
        };

        /**
        * Ends an active communication.
        */
        this.disconnect = function () {
            return imageShareImp.disconnect();
        };

        /**
        * Decline an incoming communication. 
        */
        this.reject = function () {
            return imageShareImp.reject();
        };

        /**
        * @summary Triggered when the communication is connected
        * @event
        * @param {Event} event event data
        */
        this.onConnected = function (event) {
        };

        /**
        * @summary Triggered when the communication is disconnected
        * @event
        * @param {Event} event event data
        */
        this.onDisconnected = function (event) {
        };

        /**
        * @summary Triggered when an error condition occurs
        * @event
        * @param {CommError} status Indicates the error that caused the event
        * @param {Event} event event data
        */
        this.onError = function (error, event) {
        };

        /**
        * Triggered when a change in the session state occurs
        * @event
        * @param {CommStatus} status Indicates the state that caused the event
        * @param {Event} event event data
        */
        this.onStatus = function (status, event) {
        };

        /**
        * Triggered when the complete file is received from the other party. Only the recipient will get this event.
        * @event
        * @param {Blob} message The file that was received
        * @param {Event} event event data
        */
        this.onReceived = function (message) {
        };

    }

    
    /**
     * @summary Provides access to methods for managing an address book
     * @classdesc AddressBook objects are obtained by calling the {@Link orca.createAddressBook}
     * @Constructor
     * @memberOf orca
     */
    function AddressBook(userId, token, abConfig) {
    	var abImp = abConfig.provider.createAddressBook(userId, token, abConfig, this);

    	/**
    	* Get lists.
    	* @param {boolean} getMembersInList If true, return list IDs and list members.
    	* If false, return list IDs.Default is false.
    	* @returns {List[]}
    	*/
    	this.getLists = function (getMembersInList) {
    		return abImp.getLists(getMembersInList);
    	};

    	/**
    	* Get members.
    	* @param {string} listId ID for the list
    	* @returns {List}
    	*/
    	this.getMembers = function (listId) {
    		return abImp.getMembers(listId);
    	};


    	/**
    	* Get contacts.
    	* @returns {Contact[]}
    	*/
    	this.getContacts = function () {
    		return abImp.getContacts();
    	};


    	/**
    	* Create a list, or add a member in the list. If listId is present 
    	* and member is missing then it creates an empty list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to add
    	*/
    	this.addMember = function (listId, member) {
    		return abImp.addMember(listId, member);
    	};


    	/**
    	* Create a contact.
    	* @param {Contact} contact Contact to add
    	*/
    	this.addContact = function (contact) {
    		return abImp.addContact(contact);
    	};


    	/**
    	* Update a member in the list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to update
    	*/
    	this.updateMember = function (listId, member) {
    		return abImp.updateMember(listId, member);
    	};


    	/**
    	* Update a contact.
    	* @param {Contact} contact Contact to update
    	*/
    	this.updateContact = function (contact) {
    		return abImp.updateContact(contact);
    	};

    	/**
    	* Delete the list.
    	* @param {string} listId ID for the list
    	*/
    	this.deleteList = function (listId) {
    		return abImp.deleteList(listId);
    	};


    	/**
    	* Delete a member in the list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to delete
    	*/
    	this.deleteMember = function (listId, member) {
    		return abImp.deleteMember(listId, member);
    	};


    	/**
    	* Delete a contact.
    	* @param {Contact} contact Contact to delete
    	*/
    	this.deleteContact = function (contact) {
    		return abImp.deleteContact(contact);
    	};


    	/**
    	* Transfer a member to a new list.
    	* @param {string} listId ID for the list
    	* @param {Member} member Member to move
    	* @param {string} newListId the new list ID to move to
    	*/
    	this.trnsferMember = function (listId, member, newListId) {
    		return abImp.trnsferMember(listId, member, newListId);
    	};


    	 /**
    	 * Triggered when an error condition occurs
         * @event
    	 * @param {AddressBookError} error status Indicates the error that 
    	 * caused the event
    	 * @param {Event} event event data
    	 */ 
    	 this.onError = function (error, event) {
    	 };


    	 /**
    	 * Triggered when lists is received
    	 * @event
    	 * @param {List[]} lists received lists
    	 * @param {Event} event event data
    	 */
    	 this.onGetLists = function (lists, event) {
    	 };


    	 /**
    	 * Triggered when an list is received
    	 * @event
    	 * @param {List} list received list
    	 * @param {Event} event event data
    	 */
    	 this.onGetMembers = function (list, event) {
    	 };


    	 /**
    	 * Triggered when an lists is received
    	 * @event
    	 * @param {Contact[]} contacts received contacts
    	 * @param {Event} event event data
    	 */
    	 this.onGetContacts = function (contacts, event) {
    	 };


    	 /**
    	 * Triggered when a member adds successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onAddMember = function (event) {
    	 };


    	 /**
    	 * Triggered when a contact adds successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onAddContact = function (event) {
    	 };


    	 /**
    	 * Triggered when a member updates successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onUpdateMember = function (event) {
    	 };


    	 /**
    	 * Triggered when a contact updates successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onUpdateContact = function (event) {
    	 };


    	 /**
    	 * Triggered when a list deletes successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onDeleteList = function (event) {
    	 };


    	 /**
    	 * Triggered when a member deletes successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onDeleteMember = function (event) {
    	 };


    	 /**
    	 * Triggered when a contact deletes successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onDeleteContact = function (event) { 
    	 };


    	 /**
    	 * Triggered when a member transfers successfully
    	 * @event
    	 * @param {Event} event event data
    	 */
    	 this.onTransferMember = function (event) {
    	 };
   	}
    


    /**
    * @private
    */
    function generateCallId() {
        var id = '', i,
            an = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (i = 0; i < 8; i += 1) {
            id += an.charAt(Math.floor(Math.random() * an.length));
        }
        return id;
    }

    /**
    * @private
    */
    function setTrackListEnabled(tracklist, value) {
        var i;
        for (i = 0; i < tracklist.length; i += 1) {
            tracklist[i].enabled = value;
        }
    }

    /**
    * @private
    */
    function selectStreams(list, result, id, audio, video) {
        var i, stream;
        for (i = 0; i < list.length; i += 1) {
            stream = list[i].stream();
            if ((id === '' || stream.id === id) &&
                    (!audio || stream.getAudioTracks().length > 0) &&
                    (!video || stream.getVideoTracks().length > 0)) {
                result.push(list[i]);
            }
        }
    }
     
    /**
    * @summary Possible errors associated with an orca.Call
    * @typedef CallError
    * @type enum 
    * @property {string} NETWORK_ERROR An error has occured 
    */
    CallError = {};
    CallError.NETWORK_FAILURE = 'call_error_network_failure';

    /**
    * @summary Possible states of an orca.Call
    * @typedef CallStatus
    * @type enum 
    * @property {string} CONNECTING The call is in the process of connecting to the remote party
    * @property {string} HOLD The call has been placed on hold by the local party
    * @property {string} UNHOLD The call has been taken out of the "on hold" state (Not returned
    * by Call.getStatus, as not a persistent state)
    * @property {string} REJECTED The call refused by the remote party (Not returned by 
    * Call.getStatus, as not a persistent state)
    * @property {string} CANCELED The call canceled
    * @property {string} CONNECTED The call is connected to the remote party
    * @property {string} DISCONNECTED The call is terminated
    * @property {string} REMOTE_HOLD The call has been placed on hold by the remote party (Orca
    * ALU only, not in standard Orca)
    * @property {string} UPGRADING Received an invitation to upgrade to an audiovideo call. At
    * this point, an updated media stream should be attached using {@Link orca.Call#addStream}
    * (Not returned by Call.getStatus, as not a persistent state) (Orca ALU only, not in
    * standard Orca)
    * @property {string} DOWNGRADING Received an invitation to downgrade to an audio-only call.
    * At this point, an updated media stream should be attached using {@Link orca.Call#addStream}
    * (Not returned by Call.getStatus, as not a persistent state) (Orca ALU only, not in standard
    * Orca)
    * @property {string} ADDSTREAM Received a media stream from the remote party (Not returned by
    * Call.getStatus, as not a persistent state) (Orca ALU only, not in standard Orca)
    */
    CallStatus = {};
    CallStatus.CONNECTING = 'call_status_connecting';
    CallStatus.HOLD = 'call_status_hold';
    CallStatus.UNHOLD = 'call_status_unhold';
    CallStatus.REJECTED = 'call_status_rejected';
    CallStatus.CANCELED = 'call_status_canceled';
    CallStatus.CONNECTED = 'call_status_connected';
    CallStatus.DISCONNECTED = 'call_status_disconnected';
    CallStatus.REMOTE_HOLD = 'call_status_remote_hold';
    CallStatus.UPGRADING = 'call_status_upgrading';
    CallStatus.DOWNGRADING = 'call_status_downgrading';
    CallStatus.ADDSTREAM = 'call_status_add_stream';

    /**
    * @summary Possible errors associated with an orca.Chat, orca.FileTransfer, or orca.ImageShare
    * @typedef CommError
    * @type enum 
    * @property {string} NETWORK_ERROR An error has occured 
    */
    CommError = {};
    CommError.NETWORK_FAILURE = 'comm_error_network_failure';
    CommError.NOT_SUPPORTED = 'comm_error_not_supported';

    /**
    * @summary Possible states of an orca.Chat, orca.FileTransfer, or orca.ImageShare
    * @typedef CommStatus
    * @type enum 
    * @property {string} CONNECTING The communication is in the process of connecting to the remote party
    * @property {string} REJECTED The communication refused by the remote party (Not returned by 
    * getStatus, as not a persistent state)
    * @property {string} CANCELED The communication canceled
    * @property {string} CONNECTED The communication is connected to the remote party
    * @property {string} DISCONNECTED The communication is terminated
    * @property {string} PROGRESS Some portion of a file has been sent or received. (Not returned by 
    * getStatus, as not a persistent state.)
    * @property {string} SENDSUCCESS The outgoing file or message has been delivered completely. (Not returned by 
    * getStatus, as not a persistent state.)
    * @property {string} SENDFAIL The outgoing file or message failed to be delivered. (Not returned by 
    * getStatus, as not a persistent state.)
    * @property {string} RECEIVED The incoming file or message has been received in full. (Not returned by 
    * getStatus, as not a persistent state.)
    */
    CommStatus = {};
    CommStatus.CONNECTING = 'comm_status_connecting';
    CommStatus.REJECTED = 'comm_status_rejected';
    CommStatus.CANCELED = 'comm_status_canceled';
    CommStatus.CONNECTED = 'comm_status_connected';
    CommStatus.DISCONNECTED = 'comm_status_disconnected';
    CommStatus.PROGRESS = 'comm_status_progress';
    CommStatus.SENDSUCCESS = 'comm_status_send_success';
    CommStatus.SENDFAIL = 'comm_status_send_fail';
    CommStatus.RECEIVED = 'comm_status_received';

    /**
    * @summary Provides information about an event. (This describes a data type. It is not
    * accessible as a global object.)
    * @typedef Event
    * @type object 
    * @property {(CallStatus|SessionStatus|AddressBookStatus)} name Gets the name/type indicator of the event
    */

    /**
    * @summary Provides information about the identity of a communications peer. (This describes a
    * data type. It is not accessible as a global object.)
    * @typedef PeerIdentity
    * @type object 
    * @property {string} id the unique identifier or address string of the associated user
    */

    /**
    * @summary Possible errors associated with an orca.Session
    * @typedef SessionError
    * @type enum 
    * @property {string} AUTHENTICATION_FAILED User credentials are invalid
    * @property {string} NETWORK_ERROR No response recieved within maximum expected time
    */
    SessionError = {};
    SessionError.AUTHENTICATION_FAILED = 'session_error_authentication_failed';
    SessionError.NETWORK_ERROR = 'session_error_network_error';

    /**
    * @summary Possible states of an orca.Session
    * @typedef SessionStatus
    * @type enum 
    * @property {string} CONNECTED The session has been successfully established
    * @property {string} CONNECTING The session is in the process of being established
    * @property {string} DISCONNECTED The session has been torn down
    * @property {string} INCOMINGCALL The session has received an incoming call (Not returned by
    * Session.getStatus, as not a persistent state)
    * @property {string} AUTHENTICATING The session is in the process of authentication
    * @property {string} INCOMINGCHAT The session has received an incoming chat (Not returned by
    * Session.getStatus, as not a persistent state)
    * @property {string} INCOMINGFILE The session has received an incoming file transfer (Not returned by
    * Session.getStatus, as not a persistent state)
    * @property {string} INCOMINGIMAGE The session has received an incoming image share (Not returned by
    * Session.getStatus, as not a persistent state)
    * @property {string} INCOMINGAUTOANSWER The session has received an incoming call that
    * should be answered automatically (Not returned by Session.getStatus, as it is not a 
    * persistent state)
    * @property {string} UPDATEPRESENCESUCCESS Update presence succeeded
    * (Not returned by Session.getStatus, as it is not a persistent state)
    * @property {string} UPDATEPRESENCEFAIL Update presence failed
    * (Not returned by Session.getStatus, as it is not a persistent state)
    */
    SessionStatus = {};
    SessionStatus.CONNECTED = 'session_status_connected';
    SessionStatus.CONNECTING = 'session_status_connecting';
    SessionStatus.DISCONNECTED = 'session_status_disconnected';
    SessionStatus.INCOMINGCALL = 'session_status_incoming_call';
    SessionStatus.AUTHENTICATING = 'session_status_authenticating';
    SessionStatus.INCOMINGCHAT = 'session_status_incoming_chat';
    SessionStatus.INCOMINGFILE = 'session_status_incoming_file';
    SessionStatus.INCOMINGIMAGE = 'session_status_incoming_image';
    SessionStatus.INCOMINGAUTOANSWER = 'session_status_incoming_auto_answer';
    SessionStatus.UPDATEPRESENCESUCCESS = 'session_status_update_presence_success';
    SessionStatus.UPDATEPRESENCEFAIL = 'session_status_update_presence_fail';

    /**
     * @summary Possible errors associated with an orca.AddressBook
     * @typedef AddressBookError
     * @type enum 
     * @property {string} AUTHENTICATION_FAILED User credentials are invalid
     * @property {string} CONFIG_ERROR Config are null or invalid
     * @property {string} PARAMETERS_ERROR Parameters are null or invalid  
     * @property {string} NETWORK_ERROR No response recieved within maximum expected time
     */
     AddressBookError = {};
     AddressBookError.AUTHENTICATION_FAILED = 'addressbook_error_authentication_failed';
     AddressBookError.CONFIG_ERROR = 'addressbook_error_config_error';
     AddressBookError.PARAMETERS_ERROR = 'addressbook_error_parameters_error';
     AddressBookError.NETWORK_ERROR = 'addressbook_error_network_error';
    
    
    /**
     * @summary Possible states of an orca.AddressBook
     * @typedef AddressBookStatus
     * @type enum 
     * @property {string} GETLISTS_SUCCESSFUL The getLists operation successful
     * @property {string} GETMEMBERS_SUCCESSFUL The getMembers operation successful
     * @property {string} GETCONTACTS_SUCCESSFUL The getContacts operation successful
     * @property {string} ADDMEMBER_SUCCESSFUL The addMember operation successful
     * @property {string} ADDCONTACT_SUCCESSFUL The addContact operation successful
     * @property {string} UPDATEMEMBER_SUCCESSFUL The updateMebmer operation successful
     * @property {string} UPDATECONTACT_SUCCESSFUL The updateContact operation successful
     * @property {string} DELETELIST_SUCCESSFUL The deleteList operation successful
     * @property {string} DELETEMEMBER_SUCCESSFUL The deleteMember operation successful
     * @property {string} DELETECONTACT_SUCCESSFUL The deleteContact operation successful
     * @property {string} TRANSFERMEMBER_SUCCESSFUL The transferMember operation successful
     * @property {string} GETLISTS_FAILED The getLists operation failed
     * @property {string} GETMEMBERS_FAILED The getMembers operation failed
     * @property {string} GETCONTACTS_FAILED The getContacts operation failed
     * @property {string} ADDMEMBER_FAILED The addMember operation failed
     * @property {string} ADDCONTACT_FAILED The addContact operation failed
     * @property {string} UPDATEMEMBER_FAILED The updateMebmer operation failed
     * @property {string} UPDATECONTACT_FAILED The updateContact operation failed
     * @property {string} DELETELIST_FAILED The deleteList operation failed
     * @property {string} DELETEMEMBER_FAILED The deleteMember operation failed
     * @property {string} DELETECONTACT_FAILED The deleteContact operation failed
     * @property {string} TRANSFERMEMBER_FAILED The transferMember operation failed
     */
     AddressBookStatus = {};     
     AddressBookStatus.GETLISTS_SUCCESSFUL = 'addressbook__status_getLists_successful';
     AddressBookStatus.GETMEMBERS_SUCCESSFUL = 'addressbook_status_getMembers_successful';
     AddressBookStatus.GETCONTACTS_SUCCESSFUL = 'addressbook_status_getContacts_successful';
     AddressBookStatus.ADDMEMBER_SUCCESSFUL = 'addressbook_status_addMember_successful';
     AddressBookStatus.ADDCONTACT_SUCCESSFUL = 'addressbook_status_addContact_successful';
     AddressBookStatus.UPDATEMEMBER_SUCCESSFUL = 'addressbook_status_updateMebmer_successful';
     AddressBookStatus.UPDATECONTACT_SUCCESSFUL = 'addressbook_status_updateContact_successful';
     AddressBookStatus.DELETELIST_SUCCESSFUL = 'addressbook_status_deleteList_successful';
     AddressBookStatus.DELETEMEMBER_SUCCESSFUL = 'addressbook_status_deleteMember_successful';
     AddressBookStatus.DELETECONTACT_SUCCESSFUL = 'addressbook_status_deleteContact_successful';
     AddressBookStatus.TRANSFERMEMBER_SUCCESSFUL = 'addressbook_status_transferMember_successful';
     AddressBookStatus.GETLISTS_FAILED = 'addressbook_status_getLists_failed';
     AddressBookStatus.GETMEMBERS_FAILED = 'addressbook_status_getMembers_failed';
     AddressBookStatus.GETCONTACTS_FAILED = 'addressbook_status_getContacts_failed';
     AddressBookStatus.ADDMEMBER_FAILED = 'addressbook_status_addMember_failed';
     AddressBookStatus.ADDCONTACT_FAILED = 'addressbook_status_addContact_failed';
     AddressBookStatus.UPDATEMEMBER_FAILED = 'addressbook_status_updateMebmer_failed';
     AddressBookStatus.UPDATECONTACT_FAILED = 'addressbook_status_updateContact_failed';
     AddressBookStatus.DELETELIST_FAILED = 'addressbook_status_deleteList_failed';
     AddressBookStatus.DELETEMEMBER_FAILED = 'addressbook_status_deleteMember_failed';
     AddressBookStatus.DELETECONTACT_FAILED = 'addressbook_status_deleteContact_failed';
     AddressBookStatus.TRANSFERMEMBER_FAILED = 'addressbook_status_transferMember_failed';
    
    /**
    * @summary Configuration properties for an orca.Session. (This describes a data type. It is
    * not accessible as a global object.)
    * @typedef SessionConfig
    * @type object 
    * @property {string} uri The address of the gateway server
    * @property {object} provider Reference to implementation providing actual functionality.
    * For Orca ALU, this is the orcaALU object.
    * @property {string} mediatypes The default media streams to use in calls if not specified.
    * Examples: "audio", "audio,video". Note that this is only the default, so video calls are
    * still possible even if this value is set to "audio".
    * @property {ProviderConfig} providerConfig Provider-specific settings
    */

    /**
    * @summary Provider-specific configuration properties for an orca.Session. (This
    * describes a data type. It is not accessible as a global object.) Most of these
    * advanced settings are not needed in most situations and have sensible default values,
    * thus the application does not need to set them. Typically the application will only
    * need to set conferenceFactoryURI (if advanced conferencing feature is available)
    * and crypto (to specify whether DTLS or SDES should be used.)
    * @typedef ProviderConfig
    * @type object 
    * @property {string} interfaceType Value for the signalling interface. Set as 'SIP-WS' for 
    * SIP over Websocket, 'REST-WS' for REST over Websocket. Default is SIP-WS. REST-WS was supported
    * from ORCA ECMS load 29.14.01.xx and it can only work with IMS 13.1/ISC 24.1/IBC-4 R4.0 
    * as a proof-of-concept.
    * @property {boolean} sendAuthOnInitReg If true, we include Authorization header in initial sip REGISTER.
    * The default is false meaning we would not send authorization in initial register.
    * @property {boolean} sendAuthOnReregDereg If true, we include Authorization header in sip re-register
    * and de-register messages.  The default is true meaning we would send authorization in re-register and de-register.
    * @property {boolean} reUseCallidInReregDereg If true, we will re-use the same callId used on initial register,
    * when sending re-register or de-register.  The default is true, meaning we will re-use the same callId.
    * @property {string} stun The STUN server to use for calls. Defaults to blank (none).
    * @property {boolean} bundle If false, the line "a=group:BUNDLE" is removed from the SDP if
    * present. If true, no change is made. Defaults to true.
    * @property {string} crypto Default is 'sdes-srtp'. "dtls-srtp" is used for Firefox 
    * as dtls-srtp is the only supported cryption for Firefox.
    * @property {string} conferenceFactoryURI Conference factory public ID, needed for conference
    * calling feature.
    * @property {(string|number)} expires Value for the Expires header in the initial SIP
    * REGISTER. Default is '600'.
    * @property {boolean} addCodecs If set to true, then if VP8 codec is missing from incoming
    * SDP, then all codecs are replaced with the VP8, red, and ulpfec codecs. If false, no change
    * is made. Default is false.
    * @property {string} dtmf Specify the DTMF method to use. Set as 'sip' for SIP INFO, 'inband'
    * for inband, or 'both' for both. Default is both.
    * @property {string|number} dtmfDuration Duration of a DTMF tone, in milliseconds. Default is 100.
    * @property {string|number} dtmfGap Gap between DTMF tones, in milliseconds. Default is 70.
    * @property {(string|number)} audioBandwidth The target bandwidth for audio in kilobits per
    * second. Default is unconstrained.
    * @property {(string|number)} videoBandwidth The target bandwidth for video in kilobits per
    * second. Default is unconstrained.
    * @property {(string|number)} dataBandwidth The target bandwidth for MSRP over DataChannel
    * in kilobits per second. Default is unconstrained.
    * @property {string} audioCodecs Comma-separated list of allowed audio codecs.
    * If a value is given, then any audio codecs not in the list will be removed from SDP.
    * If no value or an empty string is given, then no change is made. Default is no change.
    * @property {string} videoCodecs Comma-separated list of allowed video codecs.
    * If a value is given, then any video codecs not in the list will be removed from SDP.
    * If no value or an empty string is given, then no change is made. Default is no change.
    * @property {boolean} persistentPC If true, create a new PeerConnection whenever the
    * MediaStream is changed during a call, for example during a video upgrade or downgrade.
    * If false, use the same PeerConnection for the duration of the call. Default is false.
    * @property {boolean} breaker This option is only for interoperation with the webrtc2sip open
    * source project. True to enable the RTCWeb Breaker, false for no change. Default is false.
    * @property {boolean} stripExtraSSRC If true, remove extra and unnecessary 'synchronization
    * source' attributes (a=ssrc:) from SDP (offers or answers) which Chrome may have added
    * in scenarios involving video upgrade or downgrade. Default is true.
    * @property {boolean} confWorkaroundChrome If true, enable workaround for conference call
    * issue found in certain environments. Default is false.
    * @property {boolean} useFirstCandidate If true, use the first ICE candidate immediately
    * without waiting for any more candidates to be gathered. This is useful to prevent delay
    * in calling if candidate gathering is slow, particularly in Firefox.
    * If false, wait for the end of ICE candidates. Default is false.
    * @property {boolean} removeIPV6Candidates If true, remove any IPV6 candidates from SDP.
    * If false, no change is made. Default is false.
    * @property {string|number} autoAnswerTime Used for service continuity feature.
    * How long (in seconds) after registration the client will auto-answer new call requests.
    * This applies only to the first registration done after the page loads (which is presumed
    * to be an auto-register) and to internal re-registrations done as part of service recovery.
    * Default is 0.
    * @property {string|number} maxRecoveryAttempts Used for service continuity feature.
    * How many attempts are made to re-establish the websocket connection after a network outage.
    * Default is 5.
    * @property {string|number} networkRetryInterval Used for service continuity feature.
    * How long the client waits between attempts to re-establish the websocket connection.
    * Default is 5.
    * @property {boolean} sendRegisterOnRecovery Used for testing.
    * If true, send a register or re-invite once the websocket connection has been restored.
    * Default is false.
    * @property {string|number} registerResponseTime How long to wait (in seconds) for a 
    * register response before failing the websocket connection. Default is 0.
    * @property {string|number} registerRefreshTime How often (in seconds) to do register
    * refreshes. Default is 0.
    * @property {boolean} msidHandling Select the type of handling on incoming msid in SDP.
    * We may select from among: 'Strip Incoming MSID (default)', 'Generate/Replace Incoming MSID'
    * or 'None, no applicable handling'.
    * @property {boolean} enableMDSPsupport If true, then this device and contact is sharing
    * its PUID with other devices.  This device is either the main devie or a secondary MDSP
    * (Multiple Devices Shared PUID) device.  Default is false.
    * @property {boolean} secondaryDeviceId String to be included in SIP Contact Header to
    * identify this device and contact as an MDSP (Multiple Devices Shared PUID) Secondary device.
    * Only applicable if enableMDSPsupport is true.  AT&T is expected to set this to, mobility="fixed",
    * while, Verizon is expected to set this to, +g.gsma.rcs.ipcall. Default is, mobility="fixed".
    */

    /**
    * @summary A user's unique identifier. In Orca ALU, this is the user's public ID. (This
    * describes a data type. It is not accessible as a global object.)
    * @typedef userid
    * @type string
    */

    /**
    * @summary An authorization token associated with the provided userid. In Orca ALU, this is
    * an object containing authorization information for the SIP registration. (This describes a
    * data type. It is not accessible as a global object.)
    * @typedef token
    * @type object
    * @property {string} id The user's private ID
    * @property {string} key The user's password
    * @property {string} displayName The user's display name (optional)
    * @property {string} imsauth Set as 'sso-token' to add an Authorization header for single
    * sign-on applications. Otherwise the special header is not added. Default is undefined.
    */

    /**
     * @summary Configuration properties for an orca.AddressBook. (This describes a data type. It is
     * not accessible as a global object.)
     * @typedef AbConfig
     * @type object 
     * @property {object} provider Reference to implementation providing actual functionality.
     * For Orca ALU, this is the orcaALU object.
     * @property {string} contactServerURI The address of the contact server
     * @property {string} baseResourcePath The base API resource path
     */
    
     /**
      * @summary An AddressBook contact's basic required data
      * @typedef Contact
      * @type object
      * @property {string} id SIP/TEL/ACR address, which is used as a unique ID
      * @property {Attribute[]} attributes Any attributes
      */

     /**
      * @summary An AddressBook member's basic required data
      * @typedef Member
      * @type object
      * @property {string} id SIP/TEL/ACR address, which is used as a unique ID
      * @property {Attribute[]} attributes Any attributes
      */
     
     /**
      * @summary An AddressBook attribute's basic required data
      * @typedef Attribute
      * @type object
      * @property {string} name name of attribute
      * @property {string} value value of attribute
      */
     
     /**
      * @summary An AddressBook list's basic required data
      * @typedef List
      * @type object
      * @property {string} id a unique ID
      * @property {Member[]} members member in the list
      */
     
    /** 
    * @summary root namespace of the call control SDK
    * @global
    * @namespace 
    */
     
    orca = {
        /**
        * Create a new session instance for a user to be in connection with the server. 
        * In Orca ALU, a Session object corresponds to a SIP REGISTER session.
        * @param {userid} userid The user's unique identifier. In Orca ALU, this is the user's
        * public ID.
        * @param {token} token An authorization token associated with the provided userid
        * @param {SessionConfig} sessionConfig Session initialization parameters
        * @returns {orca.Session}
        */
        createSession: function (userid, token, sessionConfig) {
            return new Session(userid, token, sessionConfig);
        },

        /**
         * Create a new addressbook instance for a user. 
         * @param {userid} userid The user's unique identifier. In Orca ALU, this is the user's
         * public ID.
         * @param {token} token An authorization token associated with the provided userid
         * @param {AbConfig} abConfig AddressBook initialization parameters
         * @returns {orca.AddressBook}
         */
        createAddressBook: function (userid, token, abConfig) {
             return new AddressBook(userid, token, abConfig);
        },
         
        /**
        * Create a reference to a managed WebRTC media stream that can be attached 
        * to a call. Use of this method is optional, as the Call.addStream method will
        * automatically create a ManagedStream if a raw RTCMediaStream is passed to it.
        * @param {RTCMediaStream} rtcMediaStream Browser media stream
        * @returns {orca.ManagedStream}
        */
        createManagedStream: function (rtcMediaStream) {
            return new ManagedStream(rtcMediaStream);
        }
    };

    this.orca = orca;
    this.SessionStatus = SessionStatus;
    this.SessionError = SessionError;
    this.CallStatus = CallStatus;
    this.CallError = CallError;
    this.CommStatus = CommStatus;
    this.CommError = CommError;
    this.AddressBookStatus = AddressBookStatus;
    this.AddressBookError = AddressBookError;

}());
