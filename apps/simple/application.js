(function (orca, orcaALU, SessionStatus, CallStatus) {
    'use strict';
    
    var session, call, incomingCall, localStream, config, addLog, checkWSS, noop,
        txtLogin, txtPassword, btnSession, errSession, txtCallTo, btnCall, errCall,
        btnAccept, btnReject, elIncoming, vidLocal, vidRemote, elLogs;
    
    
    /***** Config *****/
    
    config = {
        webrtcGateway: 'ws://10.1.11.127:80',
        publicIdPrefix: 'sip:',
        publicIdSuffix: '@sandbox.demo.alcatel-lucent.com',
        privateIdPrefix: '',
        privateIdSuffix: '',
        conferenceFactory: 'sip:ALU_CONF@sandbox.demo.alcatel-lucent.com',
        crypto: 'dtls-srtp' //'sdes-srtp' or 'dtls-srtp'
    };
    
    
    /***** Session functions *****/
    
    function sessionCreate() {
        var userID, token, sessionConfig;
        
        // Define settings and credentials
        userID = config.publicIdPrefix + txtLogin.value + config.publicIdSuffix;  // User's public ID (example: sip:+442079590000@example.com)
        token = {
            id: config.privateIdPrefix + txtLogin.value + config.privateIdSuffix, // User's private ID (example: +442079590000)
            key: txtPassword.value,     // User's password
            displayName: txtLogin.value // User's display name (optional)
        };
        sessionConfig = {
            uri: config.webrtcGateway,  // WebRTC gateway server
            provider: orcaALU,          // Reference to Orca ALU code object
            mediatypes: 'audio',        // Default to audio if incoming call does not specify
            providerConfig: {           // Set any advanced settings here
                conferenceFactoryURI: config.conferenceFactory, // Conference factory
                crypto: config.crypto   // Key management protocol
            }
        };
        
        // Create Session
        session = orca.createSession(userID, token, sessionConfig);
        
        // Attach Session callbacks
        session.onConnected = function (event) {
            // Successfully connected to server
            addLog('session.onConnected', arguments);
            btnSession.value = 'Logout';
            btnSession.disabled = false;
            btnCall.disabled = false;
        };
        session.onDisconnected = function (event) {
            // Connection with server has been terminated or lost
            addLog('session.onDisconnected', arguments);
            
            // Clean up
            this.onConnected = noop;
            this.onDisconnected = noop;
            this.onError = noop;
            this.onIncoming = noop;
            this.onStatus = noop;
            session = null;
            if (call) {
                call.onDisconnected();
            }
            
            btnSession.value = 'Login';
            btnSession.disabled = false;
            btnCall.disabled = true;
        };
        session.onError = function (error, event) {
            // Connection error. See SessionError in orca.js for possible errors.
            addLog('session.onError', arguments);
            errSession.innerHTML = error;
            this.onDisconnected();
            checkWSS();
        };
        session.onIncoming = function (receivedCall, event) {
            // Receiving an incoming call
            addLog('session.onIncoming', arguments);
            
            // For purposes of this sample UI, keep only the most recent incoming call
            if (incomingCall) {
                incomingCall.onDisconnected = noop;
                incomingCall.reject();
            }
            incomingCall = receivedCall;
            
            // Display UI for user to choose callAccept() or callReject()
            incomingCall.onDisconnected = function (event) {
                addLog('incomingCall.onDisconnected', arguments);
                incomingCall = null;
                elIncoming.innerHTML = 'No incoming call';
                btnAccept.disabled = true;
                btnReject.disabled = true;
            };
            elIncoming.innerHTML = 'Incoming ' + incomingCall.getMediaTypes() + ' call from ' + incomingCall.remoteIdentities()[0].id;
            btnAccept.disabled = false;
            btnReject.disabled = false;
        };
        session.onStatus = function (status, event) {
            // A status event has occurred. See SessionStatus in orca.js for possible statuses.
            addLog('session.onStatus', arguments);
            switch (status) {
            case SessionStatus.CONNECTING:
                // Session is in the process of being established
                break;
            }
        };
        
        // Connect Session
        session.connect();
        
        addLog('APP: session.connect()');
        errSession.innerHTML = '';
        btnSession.value = 'Logging in...';
        btnSession.disabled = true;
        if (window.localStorage) {
            localStorage.setItem('txtLogin', txtLogin.value);
            localStorage.setItem('txtPassword', txtPassword.value);
        }
    } // end of sessionCreate
    
    function sessionEnd() {
        if (session) {
            session.disconnect();
            
            addLog('APP: session.disconnect()');
            btnSession.value = 'Logging out...';
            btnSession.disabled = true;
        }
    }


    /***** Call functions *****/
    
    function callPrepare() {
        if (call) {
            // Attach Call callbacks
            call.onConnected = function (event) {
                // Successfully connected to other party
                addLog('call.onConnected', arguments);
                btnCall.value = 'End Call';
                btnCall.disabled = false;
            };
            call.onDisconnected = function (event) {
                // The call has been disconnected
                addLog('call.onDisconnected', arguments);
            
                // Clean up
                this.onConnected = noop;
                this.onDisconnected = noop;
                this.onError = noop;
                this.onStatus = noop;
                call = null;
                if (vidLocal.src) {
                    window.URL.revokeObjectURL(vidLocal.src);
                    vidLocal.src = '';
                }
                if (vidRemote.src) {
                    window.URL.revokeObjectURL(vidRemote.src);
                    vidRemote.src = '';
                }
                if (localStream) {
                    localStream.stop();
                    localStream = null;
                }
                
                btnCall.value = 'Make Call';
                btnCall.disabled = false;
            };
            call.onAddStream = function (managedStream, event) {
                // A stream from the remote party has been received
                addLog('call.onAddStream', arguments);
                
                // Display remote stream in UI
                vidRemote.src = window.URL.createObjectURL(managedStream.stream());
            };
            call.onError = function (error, event) {
                // Call error. See CallError in orca.js for possible errors.
                addLog('call.onError', arguments);
                errCall.innerHTML = error;
                this.onDisconnected();
            };
            call.onStatus = function (status, event) {
                // A status event has occurred. See CallStatus in orca.js for possible statuses.
                addLog('call.onStatus', arguments);
                switch (status) {
                case CallStatus.REJECTED:
                    // Outgoing call was rejected by the remote party
                    this.onDisconnected();
                    break;
                }
            };

            // Add local media stream, then connect
            navigator.getUserMedia(
                { video: true, audio: true }, // Type of local media to get
                function (stream) {
                    // Successfully got local stream
                    if (call) {
                        // Add local media stream
                        call.addStream(stream);
                        
                        // Connect Call
                        call.connect();
                        
                        // Display local stream in UI
                        vidLocal.src = window.URL.createObjectURL(stream);
                        localStream = stream;
                        
                        addLog('getUserMedia success');
                        addLog('APP: call.connect()');
                        btnCall.value = 'Cancel Outgoing Call';
                        btnCall.disabled = false;
                    } else {
                        stream.stop();
                    }
                },
                function (error) {
                    // Failed to get local stream
                    if (call) {
                        call.disconnect();
                        call.onDisconnected();
                    }
                    addLog('getUserMedia failed: ' + error.name);
                    window.alert('getUserMedia failed. Error: ' + error.name);
                }
            );
            
            addLog('APP: navigator.getUserMedia()');
            btnCall.value = 'Getting webcam/microphone...';
            btnCall.disabled = true;
        }
    } // end of callPrepare
    
    function callCreate() {
        var to, mediatypes;
    
        // Define call parameters
        to = config.publicIdPrefix + txtCallTo.value + config.publicIdSuffix; // Public ID to call (example: sip:+442079590001@example.com)
        mediatypes = 'audio,video'; // Type of media to invite ('audio', 'video', or 'audio,video')
        
        // Create Call
        call = session.createCall(to, mediatypes);
        
        // Attach callbacks, add local media stream, and connect
        callPrepare();
        
        errCall.innerHTML = '';
        if (window.localStorage) {
            localStorage.setItem('txtCallTo', txtCallTo.value);
        }
    }
    
    function callEnd() {
        if (call) {
            // End the call
            call.disconnect();
            
            addLog('APP: call.disconnect()');
            btnCall.value = 'Ending call...';
            btnCall.disabled = true;
        }
    }
    
    function callAccept() {
        // Accept the incoming call
        
        // For purposes of this sample UI, replace any existing call with the new call
        if (call) {
            call.disconnect();
            call.onDisconnected();
        }
        call = incomingCall;
        incomingCall = null;
        
        // Attach callbacks, add local media stream, and connect
        callPrepare();
        
        txtCallTo.value = call.remoteIdentities()[0].id;
        txtCallTo.value = txtCallTo.value.replace(config.publicIdPrefix, '').replace(/@.*/, '');
        elIncoming.innerHTML = 'No incoming call';
        btnAccept.disabled = true;
        btnReject.disabled = true;
    }
    
    function callReject() {
        // Reject the incoming call
        if (incomingCall) {
            incomingCall.onDisconnected = noop;
            incomingCall.reject();
            incomingCall = null;
        }
        
        addLog('APP: call.reject()');
        elIncoming.innerHTML = 'No incoming call';
        btnAccept.disabled = true;
        btnReject.disabled = true;
    }


    /***** Initialize UI *****/
    
    window.setTimeout(function () {
        if (!navigator.getUserMedia) {
            navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
            if (!navigator.getUserMedia) {
                window.alert('getUserMedia is not supported by your browser. Please use the latest Chrome or Firefox.');
            }
        }
    }, 3000);
    
    window.addEventListener('load', function onPageLoad() {
        var i, el;
        document.removeEventListener('load', onPageLoad);
        
        // If container app, load Cordova
        if (!navigator.getUserMedia && navigator.userAgent.match(/Android|iPad|iPhone|iPod/i)) {
            el = document.createElement('script');
            el.type = 'text/javascript';
            el.src = '../../cordova.js';
            document.head.appendChild(el);
            el = document.createElement('a');
            el.href = 'javascript:history.back()';
            el.innerHTML = 'Back';
            document.body.insertBefore(el, document.body.firstChild);
            document.addEventListener('deviceready', function () {
                var rvtimer = false, rvwaiting = false;
                if (window.cordova) {
                    if (cordova.logger) {
                        cordova.logger.level('DEBUG');
                    }
                    if (cordova.plugins && cordova.plugins.iosrtc) {
                        cordova.plugins.iosrtc.registerGlobals();
                        function refreshVideos() {
                            if (rvtimer === false) {
                                cordova.plugins.iosrtc.refreshVideos();
                                rvtimer = window.setTimeout(function () {
                                    rvtimer = false;
                                    if (rvwaiting) {
                                        rvwaiting = false;
                                        cordova.plugins.iosrtc.refreshVideos();
                                    }
                                }, 300);
                            } else {
                                rvwaiting = true;
                            }
                        }
                        window.addEventListener('resize', refreshVideos);
                        window.addEventListener('scroll', refreshVideos);
                    }
                }
            }, false);
        }
        
        // Get elements
        txtLogin = document.getElementsByName('txtLogin')[0];
        txtPassword = document.getElementsByName('txtPassword')[0];
        btnSession = document.getElementById('btnSession');
        errSession = document.getElementById('errSession');
        txtCallTo = document.getElementsByName('txtCallTo')[0];
        btnCall = document.getElementById('btnCall');
        errCall = document.getElementById('errCall');
        btnAccept = document.getElementById('btnAccept');
        btnReject = document.getElementById('btnReject');
        elIncoming = document.getElementById('elIncoming');
        vidLocal = document.getElementById('vidLocal');
        vidRemote = document.getElementById('vidRemote');
        elLogs = document.getElementById('elLogs');
        
        // Attach UI events
        document.getElementById('formSession').addEventListener('submit', function (e) {
            e.preventDefault();
            addLog('USER: ' + btnSession.value);
            if (!session) {
                sessionCreate();
            } else {
                sessionEnd();
            }
        });
        document.getElementById('formCall').addEventListener('submit', function (e) {
            e.preventDefault();
            addLog('USER: ' + btnCall.value);
            if (!call) {
                callCreate();
            } else {
                callEnd();
            }
        });
        btnAccept.addEventListener('click', function () {
            addLog('USER: Accept Call');
            callAccept();
        });
        btnReject.addEventListener('click', function () {
            addLog('USER: Reject Call');
            callReject();
        });
        
        // Starting appearance
        btnCall.disabled = true;
        btnAccept.disabled = true;
        btnReject.disabled = true;
        el = document.getElementsByClassName('elPrefix');
        for (i = 0; i < el.length; i += 1) {
            el[i].innerHTML = config.publicIdPrefix;
        }
        el = document.getElementsByClassName('elSuffix');
        for (i = 0; i < el.length; i += 1) {
            el[i].innerHTML = config.publicIdSuffix;
        }
        if (window.localStorage) {
            txtLogin.value = localStorage.getItem('txtLogin');
            txtPassword.value = localStorage.getItem('txtPassword');
            txtCallTo.value = localStorage.getItem('txtCallTo');
        }
    });
    
    addLog = function (message, params) {
        var i, j, p, a = '';
        if (params) {
            // Construct string representation of parameters
            a = '(';
            for (i = 0; i < params.length; i += 1) {
                p = params[i];
                if (!p || typeof p === 'string' || p.constructor.name === 'Object') {
                    a += JSON.stringify(p);
                } else {
                    a += '[' + p.constructor.name + ']';
                }
                if (i < params.length - 1) {
                    a += ', ';
                }
            }
            a += ')';
        }
        // Add line and scroll to bottom
        elLogs.value += '\r\n' + message + a;
        elLogs.scrollTop = elLogs.scrollHeight;
    };
    
    checkWSS = function () {
        // Prompt to accept certificate
        var ws, id, server;
        id = 'WebSocketCertificatePrompt';
        server = config.webrtcGateway;
        function closePrompt() {
            var notice = document.getElementById(id);
            if (notice) {
                notice.getElementsByTagName('button')[0].removeEventListener('click', closePrompt);
                notice.parentNode.removeChild(notice);
            }
        };
        closePrompt();
        if (server && server.toLowerCase().indexOf('wss:') > -1) {
            ws = new WebSocket(server, ['sip']);
            ws.onopen = function () {
                this.close();
            };
            ws.onerror = function () {
                var notice, closer;
                closePrompt();
                server = server.replace(/^wss/i, 'https');
                notice = document.createElement('div');
                notice.id = id;
                notice.innerHTML = 'WebSocket server may need certificate approval. Approve certificate at '
                    + '<a href="' + server + '" target="_blank">' + server + '</a> before login.<br>'
                    + '<small>Approving the certificate will not redirect you and may appear &quot;stuck&quot; '
                    + 'even though it worked. Simply close that tab afterward.</small>';
                closer = document.createElement('button');
                closer.innerHTML = 'X';
                closer.addEventListener('click', closePrompt);
                notice.appendChild(closer);
                document.body.insertBefore(notice, document.body.firstChild);
            };
        }
    }
    
    noop = function () {};
    
}(window.orca, window.orcaALU,  window.SessionStatus,  window.CallStatus));
