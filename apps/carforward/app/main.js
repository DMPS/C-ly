// load cordova
// take state changes from calling, callcontrol, and beacon
this.app = (function (app) {
	'use strict';
	var calls = [], adjusted = [], loggingIn = false, loggedOut = false, pendingLogin = false,
		sessionState = app.calling.state.DISCONNECTED, strings;
	
	
	// Private functions -----------
	
	function log(msg) {
		window.console.log('[app/main] ' + msg);
	}
	
	function initCalling() {
		var wait, settings;
		if (loggedOut) {
			app.ui.showScreen(app.ui.screen.OFFLINE);
			return;
		}
		loggingIn = true;
		wait = 0;
		if (sessionState !== app.calling.state.DISCONNECTED) {
			wait = 500;
		}
		app.calling.logout();
		settings = app.settings.get();
		app.ui.showDialer(!!settings.calling);
		if (settings.calling && settings.user) {
			pendingLogin = true;
			window.setTimeout(app.calling.login, wait);
			app.ui.showBtnLogout(true);
		}
	}
	
	function initForwarding() {
		var settings = app.settings.get();
		app.main.setForwarding(false);
		app.ui.showForwardingToggle(settings.forwarding === 'mobile' && settings.forwardto);
	}
	
	function initBeacon() {
		app.beacon.updateMonitoring();
	}
	
	function settingsChanged() {
		var settings = app.settings.get();
		if (settings.user) {
			app.ui.displayUser();
			app.ui.showScreen(!settings.calling ? (loggedOut ? app.ui.screen.OFFLINE : app.ui.screen.HOME)
					: (loggingIn ? app.ui.screen.LOADING : (loggedOut ? app.ui.screen.OFFLINE : undefined)));
			app.ui.showForwardingToggle(settings.forwarding === 'mobile' && !!settings.forwardto && !loggedOut);
			if (loggingIn && !pendingLogin && settings.calling && sessionState === app.calling.state.DISCONNECTED) {
				app.calling.login();
				app.ui.showBtnLogout(true);
			}
		} else {
			app.ui.showSettings(true);
		}
	}
	
	
	// Event listeners -----------
	
	app.on(app.event.USER_LOGIN, function (data) {
		if (data.state) {
			if (data.isToggle) {
				log('User secret login');
				if (!loggedOut && !loggingIn && app.settings.get().calling
						&& sessionState !== app.calling.state.CONNECTED) {
					app.calling.logout();
					window.setTimeout(app.calling.login, 500);
				}
			} else {
				log('User main login');
				loggedOut = false;
				initCalling();
				initForwarding();
				initBeacon();
				settingsChanged();
			}
			app.ui.showBtnLogout(true);
		} else {
			log('User logout');
			loggedOut = true;
			loggingIn = false;
			app.beacon.updateMonitoring(false);
			app.main.setForwarding(false);
			app.ui.revertSettings();
			app.ui.showScreen(app.ui.screen.OFFLINE);
			app.ui.showBtnLogout(false);
			app.ui.displaySessionError(false);
			app.ui.showForwardingToggle(false);
			app.calling.logout();
		}
	});
	
	app.on(app.event.UI_LOAD, function () {
		initCalling();
		initForwarding();
		initBeacon();
		settingsChanged();
	});
	
	app.on(app.event.SETTINGS_CHANGE, function (data) {
		var settings;
		switch (data.component) {
		case app.settings.component.CALLING:
			initCalling();
			break;
		case app.settings.component.FORWARDING:
			initForwarding();
			break;
		case app.settings.component.BEACON:
			initBeacon();
			break;
		case '': // Empty string indicates any exit from settings, even with no change
			settingsChanged();
			break;
		}
	});
	
	app.on(app.event.SESSION_STATE, function (data) {
		var msg;
		sessionState = data.state;
		app.ui.displaySessionState(data);
		switch (sessionState) {
		case app.calling.state.TRYING:
		case app.calling.state.CONNECTING:
			pendingLogin = false;
			break;
		case app.calling.state.CONNECTED:
			loggingIn = false;
			app.ui.showScreen();
			break;
		case app.calling.state.DISCONNECTED:
		case app.calling.state.ERROR:
			sessionState = app.calling.state.DISCONNECTED;
			if (data.state === app.calling.state.ERROR) {
				if (data.certificateUrl) {
					msg = strings.acceptCertificate + '<br /><a target="_blank" href="'
						+ data.certificateUrl + '">' + data.certificateUrl + '</a>';
				} else {
					msg = strings.sessionError + data.error;
				}
			} else if (loggingIn) {
				msg = strings.sessionDisconnected;
			} else {
				msg = false;
			}
			app.ui.displaySessionError(msg);
			if ((loggingIn || loggedOut) && app.ui.getCurrentScreen() !== app.ui.screen.SETTINGS) {
				app.ui.showScreen(app.ui.screen.OFFLINE);
			}
			break;
		}
	});
	
	app.on(app.event.CALL_STATE, function (data) {
		var i, call, tab;
		// Update data and get tab element
		call = app.main.getCall(data.id);
		if (call) {
			if (data.state === app.calling.state.STREAM) {
				if (data.isLocalStream) {
					call.localStream = data.stream;
					call.localStreamUrl = data.streamUrl;
				} else {
					call.remoteStream = data.stream;
					call.remoteStreamUrl = data.streamUrl;
				}
			} else {
				call.state = data.state;
				// Remove call if ended
				switch (data.state) {
				case app.calling.state.DISCONNECTED:
				case app.calling.state.REJECTED:
				case app.calling.state.ERROR:
					window.setTimeout(function () {
						var i, c;
						for (i = 0; i < calls.length; i += 1) {
							if (data.id === calls[i].id) {
								calls.splice(i, 1);
								break;
							}
						}
						app.ui.removeTab(data.id);
					}, 2000);
					if (app.settings.get().forwarding === 'car') {
						app.callcontrol.setPolling(false);
					}
					break;
				}
			}
			app.ui.displayCallInfo(call);
		} else if (data.state === app.calling.state.INCOMING || data.state === app.calling.state.OUTGOING) {
			calls.push(data);
			app.ui.addTab(data);
			if (data.state === app.calling.state.INCOMING && app.settings.get().forwarding === 'car') {
				app.callcontrol.setPolling(true);
			}
		} else {
			log('updateCall() Unhandled case, state=' + data.state + ', id=' + data.id);
		}
	});
	
	app.on(app.event.FORWARDING_STATE, function (data) {
		app.ui.displayForwardingState(data);
	});
	
	app.on(app.event.FORWARDING_REVERSE, function (data) {
		log('Forward to mobile number ' + data.mobileUser + ' ' + app.utils.sanitizePublicId(data.mobileUser));
		var i;
		if (data.mobileUser && calls.length > 0) {
			for (i = 0; i < calls.length; i += 1) {
				app.calling.callTransfer(calls[i].id, data.mobileUser);
			}
		}
	});
	
	app.on(app.event.BEACON_NEARBY, function (data) {
		var i, settings = app.settings.get();
		if (loggedOut || settings.forwarding !== 'mobile') {
			return;
		}
		if (data.state) {
			app.main.setForwarding(true);
		} else {
			app.main.setForwarding(false);
		}
	});
	
	app.on(app.event.BEACON_PROXIMITY, function (data) {
		app.ui.displayBeaconProximity(data);
	});
	
	app.on(app.event.BEACON_MONITORING, function (data) {
		if (data.state === app.beacon.state.TRYING) {
			app.ui.displayBeaconProximity(false);
		} else if (data.state === app.beacon.state.SUCCESS && data.region) {
			app.ui.displayBeaconProximity(true);
		}
	});
	
	
	// Module interface -----------
	
	app.main = {
		getCall: function (id) {
			var i;
			for (i = 0; i < calls.length; i += 1) {
				if (calls[i].id === id) {
					return calls[i];
				}
			}
		},
		setForwarding: function (doForwarding) {
			var i, setvalue, settings = app.settings.get();
			if (settings.forwarding !== 'mobile' && !app.callcontrol.isForwarding()) {
				return;
			}
			setvalue = (typeof doForwarding === 'boolean') ? doForwarding : !app.callcontrol.isForwarding();
			if (setvalue && !app.callcontrol.isForwarding() && calls.length > 0 && !!settings.forwardto) {
				for (i = 0; i < calls.length; i += 1) {
					app.calling.callTransfer(calls[i].id, settings.forwardto);
				}
			}
			app.callcontrol.setForwarding(setvalue);
		}
	};
	
	
	// Init on page load -----------
	
	window.addEventListener('load', function () {
		var e;
		strings = app.strings.English;
		
		// Close communications on page exit
		window.onbeforeunload = function () {
			if (!loggedOut) {
				app.emit(app.event.USER_LOGIN, {state: false});
			}
		};
		
		// If container app, load Cordova
		app.ui.showBeaconSettings(false);
		app.ui.displayBeaconProximity(false);
		if (navigator.userAgent.match(/Android|iPad|iPhone|iPod/i)) {
			e = document.createElement('script');
			e.type = 'text/javascript';
			e.src = '../../cordova.js';
			document.head.appendChild(e);
			document.addEventListener('deviceready', function () {
				// Configure plugins
				var e, cordova = window.cordova;
				if (cordova.logger) {
					cordova.logger.level('DEBUG');
				}
				if (cordova.plugins) {
					if (cordova.plugins.iosrtc && navigator.userAgent.match(/iPad|iPhone|iPod/i)) {
						cordova.plugins.iosrtc.registerGlobals();
					}
					if (cordova.plugins.locationManager) {
						app.beacon.setPlugin(cordova.plugins.locationManager);
						app.ui.showBeaconSettings(true);
					}
				}
			}, false);
		}
	});
	
	return app;
}(this.app || {}));