this.app = (function (app, lab, orca, orcaALU, SessionStatus, SessionError, CallStatus, CallError) {
	'use strict';
	var cb, session, currentSettings, calls = [];
	
	function log(msg, callid) {
		window.console.log('[app/calling]' + (callid ? '[' + callid + '] ' : ' ') + msg);
	}
	function warn(msg, callid) {
		window.console.warn('[app/calling]' + (callid ? '[' + callid + '] ' : ' ') + msg);
	}
	
	function getCall(id) {
		var i;
		for (i = 0; i < calls.length; i += 1) {
			if (id === calls[i].id()) {
				return calls[i];
			}
		}
		warn('getCall() No such call', id);
	}
	
	function removeCall(id) {
		var i, j, used;
		if (typeof id !== 'string') {
			id = id.id();
		}
		for (i = 0; i < calls.length; i += 1) {
			window.call = calls[0];
			if (id === calls[i].id()) {
				if (calls[i].c_remoteStreamUrl) {
					window.URL.revokeObjectURL(calls[i].c_remoteStreamUrl);
					calls[i].c_remoteStreamUrl = undefined;
					calls[i].c_remoteStream = undefined;
				}
				if (calls[i].c_localStreamUrl) {
					used = false;
					for (j = 0; j < calls.length; j += 1) {
						if (i !== j && calls[i].c_localStream && calls[j].c_localStream
								&& calls[i].c_localStream.id === calls[j].c_localStream.id) {
							used = true;
							break;
						}
					}
					if (!used) {
						calls[i].c_localStream.stop();
						window.URL.revokeObjectURL(calls[i].c_localStreamUrl);
						
					}
					calls[i].c_localStreamUrl = undefined;
					calls[i].c_localStream = undefined;
				}
				calls.splice(i, 1);
				log('removeCall()', id);
				return;
			}
		}
		warn('removeCall() No such call', id);
	}
	
	function prepareCall(call, mediatypes) {
		log('prepareCall() ' + mediatypes, call.id());
		// Attach Call callbacks
		if (call.onConnected !== cb.call_onConnected) {
			call.onConnected = cb.call_onConnected;
			call.onDisconnected = cb.call_onDisconnected;
			call.onError = cb.call_onError;
			call.onStatus = cb.call_onStatus;
			call.onAddStream = cb.call_onAddStream;
		}
		// Get local microphone and/or webcam
		mediatypes = mediatypes || 'audio';
		navigator.getUserMedia(
			{
				audio: mediatypes.indexOf('audio') > -1,
				video: mediatypes.indexOf('video') > -1
			},
			function (stream) {
				log('getUserMedia success', call.id());
				// Attach local media stream
				call.addStream(stream);
				// Connect
				call.connect();
				
				call.c_localStream = stream;
				call.c_localStreamUrl = window.URL.createObjectURL(stream);
				app.emit(app.event.CALL_STATE, {
					id: call.id(),
					state: app.calling.state.STREAM,
					stream: stream,
					streamUrl: call.c_localStream,
					isLocalStream: true
				});
			},
			function (e) {
				warn('getUserMedia failed with error ' + e, call.id());
				app.emit(app.event.CALL_STATE, {
					id: call.id(),
					state: app.calling.state.ERROR,
					error: 'getUserMedia failed with error ' + e
				});
				removeCall(call);
			}
		);
	}
	
	function enforceDisconnect(call) {
		if (call.c_isDisconnected === undefined) {
			window.setTimeout(function () {
				if (!call.c_isDisconnected) {
					log('Force remove call', call.id());
					call.onDisconnected({});
					call.onDisconnected = cb.noop;
				}
			}, 2000);
		}
		call.c_isDisconnected = false;
	}
	
	function killSession() {
		if (session) {
			// Remove callbacks because we don't care about further events
			session.onConnected = cb.session_autoDisconnect; // just in case
			session.onDisconnected = cb.noop;
			session.onError = cb.noop;
			session.onStatus = cb.noop;
			// Disconnect and discard Session
			try {
				session.disconnect();
			} catch (e) {}
			session = undefined;
			currentSettings = undefined;
		}
	}
	
	function canModify(call) {
		var status;
		if (call) {
			status = call.getStatus();
			if (status === CallStatus.CONNECTED || status === CallStatus.HOLD) {
				return true;
			}
			warn('Cannot modify Call during status ' + status, call.id());
		}
		return false;
	}
	
	cb = {
		noop: function () {},
		session_onConnected: function (event) {
			log('cb.session_onConnected');
			app.emit(app.event.SESSION_STATE, {state: app.calling.state.CONNECTED});
		},
		session_onDisconnected: function (event) {
			log('cb.session_onDisconnected');
			app.emit(app.event.SESSION_STATE, {state: app.calling.state.DISCONNECTED});
			killSession();
		},
		session_onError: function (error, event) {
			warn('cb.session_onError ' + error);
			var msg = error, certificateUrl;
			if (error === SessionError.NETWORK_ERROR && lab.webrtcUri.indexOf('wss:') === 0) {
				// Might be due to unauthorized certificate
				certificateUrl = lab.webrtcUri.replace('wss:', 'https:');
			}
			app.emit(app.event.SESSION_STATE, {state: app.calling.state.ERROR, error: msg, certificateUrl: certificateUrl});
			killSession();
		},
		session_onStatus: function (status, event) {
			log('cb.session_onStatus ' + status);
			if (status === SessionStatus.CONNECTING) {
				app.emit(app.event.SESSION_STATE, {state: app.calling.state.CONNECTING});
			} else {
				warn('Unhandled SessionStatus ' + status);
			}
		},
		session_onIncoming: function (call, event) {
			var r = call.remoteIdentities()[0].id;
			log('cb.session_onIncoming remote=' + r + ' media=' + call.getMediaTypes(), call.id());
			call.onDisconnected = cb.call_onDisconnected;
			call.onError = cb.call_onError;
			calls.push(call);
			app.emit(app.event.CALL_STATE, {
				id: call.id(),
				remote: r,
				remoteNumber: app.utils.getNumberFromPublicId(r),
				remotePrettyNumber: app.utils.getPrettyNumber(r),
				media: call.getMediaTypes(),
				state: app.calling.state.INCOMING
			});
		},
		session_onIncomingNotSupported: function (comm) {
			// Auto-reject any communications other than Calls
			if (typeof comm.reject === 'function') {
				comm.reject();
				warn('cb.session_onIncomingNotSupported ' + comm.constructor + ' from <' + comm.remoteIdentities()[0].id);
			} else if (comm.message) {
				warn('cb.session_onIncomingNotSupported PageModeChat from <' + comm.from + '>: ' + comm.message);
			} else {
				warn('cb.session_onIncomingNotSupported ' + comm.constructor);
			}
		},
		session_autoDisconnect: function (event) {
			this.disconnect();
		},
		call_onConnected: function (event) {
			log('cb.call_onConnected', this.id());
			app.emit(app.event.CALL_STATE, {
				id: this.id(),
				state: app.calling.state.CONNECTED
			});
		},
		call_onDisconnected: function (event) {
			log('cb.call_onDisconnected', this.id());
			this.c_isDisconnected = true;
			app.emit(app.event.CALL_STATE, {
				id: this.id(),
				state: app.calling.state.DISCONNECTED
			});
			removeCall(this);
		},
		call_onError: function (error, event) {
			log('cb.call_onError ' + error, this.id());
			this.c_isDisconnected = true;
			app.emit(app.event.CALL_STATE, {
				id: this.id(),
				state: app.calling.state.ERROR,
				error: error
			});
			removeCall(this);
		},
		call_onStatus: function (status, event) {
			log('cb.call_onStatus ' + status, this.id());
			var s;
			switch (status) {
			case CallStatus.REJECTED:
				this.c_isDisconnected = true;
				s = app.calling.state.REJECTED;
				removeCall(this);
				break;
			case CallStatus.CONNECTING:
				s = app.calling.state.CONNECTING;
				break;
			case CallStatus.HOLD:
				s = app.calling.state.HOLD;
				break;
			case CallStatus.REMOTE_HOLD:
				s = app.calling.state.REMOTE_HOLD;
				break;
			case CallStatus.UPGRADING:
				s = app.calling.state.UPGRADING;
				break;
			case CallStatus.DOWNGRADING:
				s = app.calling.state.DOWNGRADING;
				break;
			}
			if (s) {
				app.emit(app.event.CALL_STATE, {
					id: this.id(),
					state: s
				});
			} else {
				warn('Unhandled CallStatus ' + status, this.id());
			}
		},
		call_onAddStream: function (managedStream, event) {
			log('cb.call_onAddStream ' + managedStream.stream().id, this.id());
			this.c_remoteStream = managedStream.stream();
			this.c_remoteStreamUrl = window.URL.createObjectURL(this.c_remoteStream);
			app.emit(app.event.CALL_STATE, {
				id: this.id(),
				state: app.calling.state.STREAM,
				stream: this.c_remoteStream,
				streamUrl: this.c_remoteStreamUrl,
				isLocalStream: false
			});
		}
	};
	
	app.calling = {
		login: function () {
			var settings, userID, token, sessionConfig, status;
			if (session) {
				status = session.getStatus();
				if (status === SessionStatus.CONNECTING || status === SessionStatus.CONNECTED) {
					warn('app.calling.login Canceled because Session already exists');
					return;
				}
			}
			log('app.calling.login');
			settings = app.settings.get();
			currentSettings = {user: settings.user, password: settings.password, name: settings.name};
			// Construct Session parameters
			userID = lab.puidPrefix + settings.user + lab.puidSuffix;
			token = {
				id: lab.pridPrefix + settings.user + lab.pridSuffix,
				key: settings.password,
				displayName: settings.name || settings.user
			};
			sessionConfig = {
				uri: lab.webrtcUri,
				provider: orcaALU,
				mediatypes: 'audio,video',
				providerConfig: {
					conferenceFactoryURI: lab.conferenceFactory,
					crypto: lab.crypto,
					useFirstCandidate: true
				}
			};
			// Create Session
			session = orca.createSession(userID, token, sessionConfig);
			// Attach Session callbacks
			session.onConnected = cb.session_onConnected;
			session.onDisconnected = cb.session_onDisconnected;
			session.onError = cb.session_onError;
			session.onStatus = cb.session_onStatus;
			session.onIncoming = cb.session_onIncoming;
			session.onIncomingChat = cb.session_onIncomingNotSupported;
			session.onIncomingFileTransfer = cb.session_onIncomingNotSupported;
			session.onIncomingImageShare = cb.session_onIncomingNotSupported;
			session.onIncomingPageModeChat = cb.session_onIncomingNotSupported;
			// Connect
			session.connect();
			app.emit(app.event.SESSION_STATE, {state: app.calling.state.TRYING});
		},
		logout: function () {
			if (!session) {
				log('app.calling.logout Canceled because there is no Session to disconnect');
				return;
			}
			log('app.calling.logout');
			killSession();
			app.emit(app.event.SESSION_STATE, {state: app.calling.state.DISCONNECTED});
		},
		makeCall: function (number, media) {
			var call, to, mediatypes;
			if (!session || session.getStatus() !== SessionStatus.CONNECTED) {
				warn('app.calling.makeCall Failed because no connected Session');
				return;
			}
			if (!navigator.getUserMedia) {
				navigator.getUserMedia = navigator.webkitGetUserMedia;
				if (!navigator.getUserMedia) {
					warn('app.calling.makeCall Failed because getUserMedia not supported');
					app.ui.alert('Your browser does not support WebRTC getUserMedia');
					return;
				}
			}
			// Construct Call parameters
			to = app.utils.sanitizePublicId(number);
			mediatypes = media || 'audio';
			// Create Call
			call = session.createCall(to, mediatypes);
			// Prepare Call...
			log('app.calling.makeCall Call created', call.id());
			app.emit(app.event.CALL_STATE, {
				id: call.id(),
				remote: to,
				remoteNumber: app.utils.getNumberFromPublicId(to),
				remotePrettyNumber: app.utils.getPrettyNumber(to),
				media: mediatypes,
				state: app.calling.state.OUTGOING
			});
			calls.push(call);
			prepareCall(call, mediatypes);
		},
		callAccept: function (id) {
			log('app.calling.callAccept', id);
			var call = getCall(id);
			if (call) {
				prepareCall(call);
			}
		},
		callReject: function (id) {
			log('app.calling.callReject', id);
			var call = getCall(id);
			if (call) {
				enforceDisconnect(call);
				call.reject();
			}
		},
		callDisconnect: function (id) {
			log('app.calling.callDisconnect', id);
			var call = getCall(id);
			if (call) {
				enforceDisconnect(call);
				call.disconnect();
			}
		},
		callStartVideo: function (id) {
			log('app.calling.callStartVideo', id);
			var call = getCall(id);
			if (canModify(call)) {
				if (call.getMediaTypes() === 'audio') {
					prepareCall(call, 'audio,video');
				} else {
					warn('Video is already started');
				}
			}
		},
		callStopVideo: function (id) {
			log('app.calling.callStopVideo', id);
			var call = getCall(id);
			if (canModify(call)) {
				if (call.getMediaTypes() !== 'audio') {
					prepareCall(call, 'audio');
				} else {
					warn('Video is already stopped');
				}
			}
		},
		callHold: function (id, holdtype) {
			log('app.calling.callHold', id);
			var call = getCall(id);
			if (canModify(call)) {
				if (call.getStatus() !== CallStatus.HOLD) {
					call.hold(holdtype || undefined);
				} else {
					warn('Cannot hold call that is already on hold');
				}
			}
		},
		callUnhold: function (id) {
			log('app.calling.callUnhold', id);
			var call = getCall(id);
			if (canModify(call)) {
				if (call.getStatus() === CallStatus.HOLD) {
					call.resume();
				} else {
					warn('Cannot unhold call that is not on hold');
				}
			}
		},
		callTransfer: function (id, target) {
			log('app.calling.callTransfer', id);
			var call = getCall(id);
			if (canModify(call)) {
				if (target) {
					call.transfer(app.utils.sanitizePublicId(target));
				} else {
					warn('Cannot transfer call without a target');
				}
			}
		},
		getCurrentSettings: function () {
			return currentSettings;
		},
		state: {
			// For Session and Call
			CONNECTING: 'CONNECTING',
			CONNECTED: 'CONNECTED',
			DISCONNECTED: 'DISCONNECTED',
			ERROR: 'ERROR',
			// For Session only
			TRYING: 'TRYING',
			// For Call only
			INCOMING: 'INCOMING',
			OUTGOING: 'OUTGOING',
			REJECTED: 'REJECTED',
			STREAM: 'STREAM',
			HOLD: 'HOLD',
			REMOTE_HOLD: 'REMOTE_HOLD',
			UPGRADING: 'UPGRADING',
			DOWNGRADING: 'DOWNGRADING'
		}
	};
	
	return app;
}(this.app || {}, this.defaultConfig, this.orca, this.orcaALU, this.SessionStatus, this.SessionError, this.CallStatus, this.CallError));