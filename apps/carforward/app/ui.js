this.app = (function (app, lab) {
	'use strict';
	var el = {}, cb, strings, adjusted = [],
		isTouch, touchTimer = false, currentScreen, currentTab = '';
	
	
	// Private functions -----------
	
	function log(msg) {
		window.console.log('[app/ui] ' + msg);
	}
	
	function scrollTo(a) {
		var top = 0;
		if (typeof a === 'number') {
			top = a;
		} else if (a && typeof a.getBoundingClientRect === 'function') {
			top = a.getBoundingClientRect();
			if (top.top === 0 && top.bottom === 0 && top.left === 0 && top.right === 0) {
				return false;
			}
			top = top.top + el.screens.scrollTop;
		}
		el.screens.scrollTop = top;
		return top;
	}
	
	function addAdjusted(element, minusHeight) {
		adjusted.push(arguments);
		cb.adjustSize(arguments);
	}
	
	function modifyAdjusted(element, minusHeight, remove) {
		var i;
		for (i = 0; i < adjusted.length; i += 1) {
			if (element === adjusted[i][0]) {
				if (remove) {
					adjusted.splice(i, 1);
				} else {
					adjusted[i][1] = minusHeight;
					cb.adjustSize(adjusted[i]);
				}
				break;
			}
		}
	}
	
	function addPreSpans(e) {
		var i, d;
		for (i = 0; i < e.length; i += 1) {
			d = document.createElement('span');
			e[i].parentElement.insertBefore(d, e[i].nextSibling);
		}
	}
	
	function showExpand(expander, isShow, noScroll) {
		if (typeof isShow !== 'boolean') {
			isShow = expander.checked;
		}
		expander.parentElement.parentElement.nextElementSibling.style.display = isShow ? '' : 'none';
		if (isShow && !noScroll) {
			if (scrollTo(expander) === false && expander.parentElement) {
				scrollTo(expander.parentElement);
			}
		}
	}
	
	function showTabs(isShow) {
		if (typeof isShow !== 'boolean') {
			isShow = true;
		}
		if (isShow && el.tabs.childElementCount > 1
				 && (currentScreen === app.ui.screen.CALL || currentScreen === app.ui.screen.HOME)) {
			el.tabs.style.display = '';
			modifyAdjusted(el.screens, 110);
		} else {
			el.tabs.style.display = 'none';
			modifyAdjusted(el.screens, 60);
		}
	}
	
	function showButtons(a) {
		var i, e = el.callButtons.children;
		if (a && a.length) {
			for (i = 0; i < e.length; i += 1) {
				if (a[i] === false) {
					e[i].style.display = 'none';
				} else if (a[i] === true) {
					e[i].style.display = '';
				}
			}
		}
	}
	
	function saveSettings() {
		var f, data = {}, settings = app.settings.get();
		for (f in settings) {
			if (settings.hasOwnProperty(f) && el.settingsform.elements.hasOwnProperty(f)) {
				if (el.settingsform.elements[f].type === 'checkbox') {
					data[f] = el.settingsform.elements[f].checked ? 'true' : '';
				} else {
					data[f] = el.settingsform.elements[f].value;
				}
			}
		}
		app.settings.set(data);
	}
	
	function loadSettings() {
		var f, settings = app.settings.get();
		for (f in settings) {
			if (settings.hasOwnProperty(f) && el.settingsform.elements.hasOwnProperty(f)) {
				if (el.settingsform.elements[f].type === 'checkbox') {
					el.settingsform.elements[f].checked = (!!settings[f]);
					if (settings[f]) {
						el.settingsform.elements[f].setAttribute('checked', 'checked');
					} else {
						el.settingsform.elements[f].removeAttribute('checked');
					}
				} else {
					el.settingsform.elements[f].value = settings[f];
					if (isNaN(el.settingsform.elements[f].length)) {
						el.settingsform.elements[f].setAttribute('value', settings[f]);
					}
				}
			}
		}
		for (f = 0; f < el.expander.length; f += 1) {
			showExpand(el.expander[f], undefined, true);
		}
		f = el.settingsform.elements.forwarding;
		showExpand(f[0], f.value === 'mobile', true);
		el.formWarning.style.display = settings.user ? '' : 'inline';
		scrollTo(0);
	}
	
	function setFormStrings(formId) {
		var h, t, s, f, i;
		s = strings.form[formId];
		h = document.getElementById(formId);
		t = h.getElementsByTagName('h2');
		if (t) {
			t.innerHTML = s.title;
		}
		s = s.el;
		h = h.elements;
		for (f in s) {
			if (s.hasOwnProperty(f) && h.hasOwnProperty(f)) {
				if (h[f].length > 0) {
					h[f][0].parentElement.parentElement.firstElementChild.innerHTML = s[f][0];
					for (i = 0; i < h[f].length; i += 1) {
						t = document.createTextNode(s[f][i + 1] + ' ');
						h[f][i].parentElement.appendChild(t);
					}
				} else if (h[f].tagName.toLowerCase() === 'button') {
					h[f].innerHTML = s[f];
				} else {
					t = document.createTextNode(s[f] + ' ');
					h[f].parentElement.insertBefore(t, h[f].parentElement.firstChild);
				}
			}
		}
	}
	
	function setRingOut(isOn) {
		window.clearTimeout(el.ringOutTimeout);
		el.ringOutTimeout = undefined;
		if (isOn === true) {
			if (!el.ringOut) {
				el.ringOut = new window.Audio('assets/ringtone_caller.WAV');
			}
			el.ringOut.loop = true;
			el.ringOut.play();
			el.ringOutTimeout = setTimeout(setRingOut, 10000);
		} else {
			if (el.ringOut) {
				el.ringOut.pause();
			}
		}
	}
	
	function setRingIn(isOn) {
		window.clearTimeout(el.ringInTimeout);
		el.ringInTimeout = undefined;
		if (isOn === true) {
			if (!el.ringIn) {
				el.ringIn = new window.Audio('assets/ringtone.wav');
			}
			el.ringIn.loop = true;
			el.ringIn.play();
			el.ringInTimeout = setTimeout(setRingIn, 10000);
		} else {
			if (el.ringIn) {
				el.ringIn.pause();
			}
		}
	}
	
	
	// Callbacks -----------
	
	cb = {
		adjustSize: function (e) {
			var i;
			if (e && e[0] && e[0].style) {
				if (typeof e[1] === 'number') {
					e[0].style.height = (window.innerHeight - e[1]) + 'px';
				}
				if (typeof e[2] === 'number') {
					e[0].style.width = (window.innerWidth - e[2]) + 'px';
				}
			} else {
				for (i = 0; i < adjusted.length; i += 1) {
					cb.adjustSize(adjusted[i]);
				}
			}
		},
		tabClick: function (event) {
			// Show either home or call screen with the relevant tab information
			var i, c = el.tabs.children,
				id = this.id ? this.id.replace('tab_', '') : currentTab;
			for (i = 0; i < c.length; i += 1) {
				c[i].className = (c[i].id === 'tab_' + id) ? 'selected' : '';
			}
			if (id === '') {
				app.ui.showScreen(app.ui.screen.HOME);
			} else {
				currentTab = id;
				app.ui.showScreen(app.ui.screen.CALL);
				app.ui.displayCallInfo(app.main.getCall(id));
			}
		},
		dialerKeyMove: function (event) {
			event.preventDefault();
		},
		dialerKeyDown: function (event) {
			var n = this.getElementsByTagName('span')[0].innerHTML;
			touchTimer = setTimeout(function () {
				touchTimer = false;
				if (n === '0') {
					// Dial "+"
					el.dialoutput.value += '+';
				}
			}, 600);
			event.preventDefault();
		},
		dialerKeyUp: function () {
			var n = this.getElementsByTagName('span')[0].innerHTML;
			if (n !== '&nbsp;') {
				if (!(n === '0' && touchTimer === false)) {
					// Dial digit
					el.dialoutput.value += n;
				}
			}
			/*else {
				// Do action
				n = this.className;
				switch (n) {
				case 'call':
					cb.btnMakeCallClick();
					break;
				}
			}*/
			clearTimeout(touchTimer);
			touchTimer = false;
		},
		btnMakeCallClick: function (event) {
			if (el.dialoutput.value) {
				app.calling.makeCall(el.dialoutput.value, 'audio');
			}
			if (event) {
				event.preventDefault();
			}
		},
		btnCallAcceptClick: function (event) {
			app.calling.callAccept(currentTab);
			if (event) {
				event.preventDefault();
			}
		},
		btnCallRejectClick: function (event) {
			app.calling.callReject(currentTab);
			if (event) {
				event.preventDefault();
			}
		},
		btnCallDisconnectClick: function (event) {
			app.calling.callDisconnect(currentTab);
			if (event) {
				event.preventDefault();
			}
		},
		btnBackspaceClick: function (event) {
			el.dialoutput.value = el.dialoutput.value.slice(0, -1);
			if (event) {
				event.preventDefault();
			}
		},
		toggleLoginClick: function () {
			app.emit(app.event.USER_LOGIN, {state: true, isToggle: true});
		},
		btnLoginClick: function () {
			app.emit(app.event.USER_LOGIN, {state: true});
		},
		btnLogoutClick: function () {
			app.emit(app.event.USER_LOGIN, {state: false});
		},
		toggleForwardingClick: function () {
			log('User Toggle Forwarding');
			app.main.setForwarding();
		},
		toggleSettingsClick: function (doShow) {
			var settings, f, changed;
			if (typeof doShow !== 'boolean') {
				doShow = (el.screens.getElementsByClassName('screen_settings')[0].style.display !== 'block');
			}
			if (doShow) {
				// Show settings
				loadSettings();
				if (currentScreen === app.ui.screen.LOADING) {
					app.calling.logout();
				}
				el.toggleSettings.innerHTML = strings.save;
				el.revertSettings.style.display = '';
				app.ui.showForwardingToggle(false);
				app.ui.showScreen(app.ui.screen.SETTINGS);
			} else {
				// Save and verify new settings
				log('User Save Settings');
				el.toggleSettings.innerHTML = '';
				el.revertSettings.style.display = 'none';
				saveSettings();
			}
		},
		revertSettingsClick: function () {
			el.revertSettings.style.display = 'none';
			el.toggleSettings.innerHTML = '';
			app.emit(app.event.SETTINGS_CHANGE, {component: ''});
			//el.settingsform.reset();
		},
		revertBeaconClick: function (event) {
			el.settingsform.elements.beaconUuid.value = lab.beaconUuid;
			el.settingsform.elements.beaconMajor.value = lab.beaconMajor;
			el.settingsform.elements.beaconMinor.value = lab.beaconMinor;
			event.preventDefault();
		},
		fwdClick: function () {
			showExpand(this, this.value === 'mobile');
		},
		expanderClick: function () {
			showExpand(this);
		},
		textboxClick: function () {
			var e = this;
			function keyboardpop() {
				window.removeEventListener('resize', keyboardpop);
				setTimeout(function () {
					scrollTo(e);
				}, 100);
			}
			window.addEventListener('resize', keyboardpop);
			setTimeout(function () {
				window.removeEventListener('resize', keyboardpop);
			}, 1200);
		}
	};
	
	
	// Module interface -----------
	
	app.ui = {
		screen: {
			CALL: 'call',
			HOME: 'home',
			LOADING: 'loading',
			OFFLINE: 'offline',
			SETTINGS: 'settings'
		},
		alert: function (msg) {
			window.alert(msg);
		},
		showSettings: cb.toggleSettingsClick,
		revertSettings: cb.revertSettingsClick,
		getCurrentScreen: function () {
			return currentScreen;
		},
		showScreen: function (screen) {
			var i, c;
			if (!screen) {
				cb.tabClick();
				return;
			}
			currentScreen = screen;
			c = el.screens.children;
			for (i = 0; i < c.length; i += 1) {
				c[i].style.display = c[i].className.indexOf('screen_' + screen) > -1 ? 'block' : 'none';
			}
			showTabs();
		},
		addTab: function (data) {
			var tab = document.createElement('span');
			tab.id = 'tab_' + data.id;
			tab.innerHTML = data.remotePrettyNumber;
			tab.addEventListener('click', cb.tabClick);
			el.tabs.appendChild(tab);
			if (data.state === app.calling.state.INCOMING) {
				data.isRingingIn = true;
				setRingIn(true);
			} else {
				data.isRingingOut = true;
				setRingOut(true);
			}
			currentTab = data.id;
			cb.tabClick();
		},
		removeTab: function (id) {
			var c, i;
			c = el.tabs.children;
			for (i = 0; i < c.length; i += 1) {
				if (c[i].id === 'tab_' + id) {
					c[i].removeEventListener('click', cb.tabClick);
					el.tabs.removeChild(c[i]);
					break;
				}
			}
			if (currentTab === id) {
				if (c[1]) {
					currentTab = c[1].id;
				} else {
					currentTab = '';
				}
				cb.tabClick();
			} else {
				showTabs();
			}
		},
		showBtnLogout: function (isShow) {
			el.btnLogout.style.display = isShow ? '' : 'none';
		},
		showForwardingToggle: function (isShow) {
			el.toggleForwarding.style.display = isShow ? '' : 'none';
		},
		showBeaconSettings: function (isShow) {
			if (!el.beaconSettings) {
				el.beaconSettings = document.getElementById('beaconSettings');
			}
			el.beaconSettings.style.display = isShow ? '' : 'none';
		},
		showDialer: function (isShow) {
			if (isShow) {
				document.body.className = document.body.className.replace(/ noDialer/g, '');
			} else {
				document.body.className += ' noDialer';
			}
		},
		displayUser: function (number, name) {
			var settings = app.settings.get();
			el.currentUserNumber.innerHTML = number || app.utils.getPrettyNumber(
				app.utils.sanitizePublicId(settings.user)
			);
			//el.currentUserName.innerHTML = name || settings.name;
		},
		displaySessionError: function (msg) {
			el.sessionErrorMessage.innerHTML = msg || '';
			el.sessionErrorMessage.style.display = msg ? '' : 'none';
		},
		displaySessionState: function (data) {
			var cls;
			switch (data.state) {
			case app.calling.state.TRYING:
				break;
			case app.calling.state.CONNECTING:
				cls = 'connecting';
				break;
			case app.calling.state.CONNECTED:
				cls = 'connected';
				break;
			case app.calling.state.DISCONNECTED:
			case app.calling.state.ERROR:
				cls = 'disconnected';
				break;
			}
			if (cls) {
				el.loginState.className = cls;
			}
		},
		displayCallInfo: function (call) {
			if (!call) {
				return;
			}
			// UI changes that happen outside the visible tab content
			if (call.isRingingIn || call.isRingingOut) {
				switch (call.state) {
				case app.calling.state.CONNECTED:
				case app.calling.state.DISCONNECTED:
				case app.calling.state.ERROR:
				case app.calling.state.REJECTED:
					call.isRingingIn = false;
					call.isRingingOut = false;
					setRingIn(false);
					setRingOut(false);
					break;
				}
			}
			// UI changes that happen inside the tab content
			if (currentTab && call.id !== currentTab) {
				return;
			}
			if (call.remoteStreamUrl) {
				el.remoteAudio.src = call.remoteStreamUrl;
			}
			el.callstatus.innerHTML = strings.callstatus[call.state];
			el.callparty.innerHTML = call.remotePrettyNumber;
			switch (call.state) {
			case app.calling.state.INCOMING:
				// show accept and reject
				showButtons([true, true, false]);
				break;
			case app.calling.state.OUTGOING:
			case app.calling.state.CONNECTING:
			case app.calling.state.CONNECTED:
			case app.calling.state.HOLD:
			case app.calling.state.REMOTE_HOLD:
			case app.calling.state.UPGRADING:
			case app.calling.state.DOWNGRADING:
				//show disconnect
				showButtons([false, false, true]);
				break;
			case app.calling.state.DISCONNECTED:
			case app.calling.state.REJECTED:
			case app.calling.state.ERROR:
				//show nothing
				showButtons([false, false, false]);
				break;
			}
			showTabs();
		},
		displayForwardingState: function (data) {
			var c;
			switch (data.state) {
			case app.callcontrol.state.TRYING:
				c = '<span></span>';
				break;
			case app.callcontrol.state.SUCCESS:
			case app.callcontrol.state.ERROR:
				c = data.isForwarding ? strings.forwarding : '';
				break;
			}
			el.toggleForwarding.innerHTML = c;
			el.toggleForwarding.style.opacity = data.isForwarding ? 1 : 0.5;
		},
		displayBeaconProximity: function (data) {
			if (!el.beaconProximity) {
				el.beaconProximity = document.getElementById('beaconProximity');
			}
			if (typeof data === 'boolean') {
				el.beaconProximity.parentElement.style.display = data ? '' : 'none';
			} else {
				el.beaconProximity.parentElement.style.display = '';
				el.beaconProximity.innerHTML = data.state || strings.beaconNotFound;
			}
		},
		debugBeacon: function (msg, level) {}
	}; //end of app.ui
	
	
	// Init on page load -----------
	
	window.addEventListener('load', function () {
		var i, d, k, e, e2, e3, tab;
		
		// Determine device type
		isTouch = (window.ontouchstart !== undefined);
		if (isTouch) {
			document.body.className = 'isTouch';
		}
		
		// Get elements
		el.currentUserNumber = document.getElementById('currentUserNumber');
		el.currentUserName = document.getElementById('currentUserName');
		el.callstatus = document.getElementById('callstatus');
		el.callparty = document.getElementById('callparty');
		el.callButtons = document.getElementById('callButtons');
		el.remoteAudio = document.getElementById('remoteAudio');
		el.dialoutput = document.getElementById('dialoutput');
		el.screens = document.getElementById('screens');
		el.settingsform = document.getElementById('settingsform');
		el.formWarning = el.settingsform.getElementsByClassName('formWarning')[0];
		el.revertSettings = document.getElementById('revertSettings');
		el.revertSettings.style.display = 'none';
		el.toggleSettings = document.getElementById('toggleSettings');
		el.toggleForwarding = document.getElementById('toggleForwarding');
		el.toggleForwarding.style.display = 'none';
		el.toggleForwarding.style.opacity = 0.5;
		el.revertBeacon = document.getElementById('revertBeacon');
		el.loginState = document.getElementById('loginState');
		el.btnLogin = document.getElementById('btnLogin');
		el.btnLogout = document.getElementById('btnLogout');
		el.btnMakeCall = document.getElementById('btnMakeCall');
		el.btnCallAccept = document.getElementById('btnCallAccept');
		el.btnCallReject = document.getElementById('btnCallReject');
		el.btnCallDisconnect = document.getElementById('btnCallDisconnect');
		el.btnBackspace = document.getElementById('btnBackspace');
		el.sessionErrorMessage = document.getElementById('sessionErrorMessage');
		el.sessionErrorMessage.style.display = 'none';
		el.tabs = document.getElementById('tabs');
		el.expander = document.getElementsByClassName('expander');
		
		// Create elements
		addPreSpans(el.settingsform.getElementsByClassName('chkbx'));
		addPreSpans(el.settingsform.getElementsByClassName('rdio'));
		tab = document.createElement('span');
		tab.id = 'tab_';
		tab.addEventListener('click', cb.tabClick);
		el.tabs.appendChild(tab);
		el.tabs.style.display = 'none';
		
		// Set strings
		strings = app.strings.English;
		tab.innerHTML = strings.dialer;
		e = document.createElement('span');
		e.innerHTML = strings.incoming;
		el.formWarning.innerHTML = strings.requiredField;
		el.revertSettings.innerHTML = strings.cancel;
		el.revertBeacon.innerHTML = strings.revertBeacon;
		el.btnLogin.innerHTML = strings.login;
		el.btnLogout.innerHTML = strings.logout;
		el.btnMakeCall.innerHTML = strings.call;
		el.btnCallAccept.innerHTML = strings.accept;
		el.btnCallReject.innerHTML = strings.reject;
		el.btnCallDisconnect.innerHTML = strings.disconnect;
		document.getElementById('currentUserMessage').innerHTML = strings.currentUserMessage;
		document.getElementById('beaconProximityMessage').innerHTML = strings.beaconProximityMessage;
		setFormStrings('settingsform');
		
		// Set listeners
		window.addEventListener('resize', cb.adjustSize);
		addAdjusted(el.screens, 60);
		el.btnLogin.addEventListener('click', cb.btnLoginClick);
		el.btnLogout.addEventListener('click', cb.btnLogoutClick);
		el.btnMakeCall.addEventListener('click', cb.btnMakeCallClick);
		document.getElementById('dialerform').addEventListener('submit', cb.btnMakeCallClick);
		el.btnMakeCall.addEventListener('mousedown', cb.dialerKeyMove);
		el.btnMakeCall.addEventListener('mousemove', cb.dialerKeyMove);
		el.btnBackspace.addEventListener('click', cb.btnBackspaceClick);
		el.btnBackspace.addEventListener('mousedown', cb.dialerKeyMove);
		el.btnBackspace.addEventListener('mousemove', cb.dialerKeyMove);
		el.btnCallAccept.addEventListener('click', cb.btnCallAcceptClick);
		el.btnCallReject.addEventListener('click', cb.btnCallRejectClick);
		el.btnCallDisconnect.addEventListener('click', cb.btnCallDisconnectClick);
		el.revertSettings.addEventListener('click', cb.revertSettingsClick);
		el.toggleSettings.addEventListener('click', cb.toggleSettingsClick);
		el.toggleForwarding.addEventListener('click', cb.toggleForwardingClick);
		el.revertBeacon.addEventListener('click', cb.revertBeaconClick);
		document.getElementById('toggleLogin').addEventListener('click', cb.toggleLoginClick);
		e = el.settingsform.elements.forwarding;
		for (i = 0; i < e.length; i += 1) {
			e[i].addEventListener('click', cb.fwdClick);
		}
		for (i = 0; i < el.expander.length; i += 1) {
			el.expander[i].addEventListener('change', cb.expanderClick);
		}
		if (isTouch && window.innerHeight < 650 && window.innerWidth < 650) {
			// Account for keyboard popping up and pushing text field out of view
			for (i = 0; i < el.settingsform.elements.length; i += 1) {
				e2 = el.settingsform.elements[i].type;
				if (e2 === 'text' || e2 === 'tel' || e2 === 'password' || e2 === 'number' || e2 === 'textarea') {
					el.settingsform.elements[i].addEventListener('click', cb.textboxClick);
				}
			}
		}
		
		// Create dialer
		d = document.getElementById('dialpad');
		k = [
			{n: '1'},
			{n: '2', s: 'ABC'},
			{n: '3', s: 'DEF'},
			{n: '4', s: 'GHI'},
			{n: '5', s: 'JKL'},
			{n: '6', s: 'MNO'},
			{n: '7', s: 'PQRS'},
			{n: '8', s: 'TUV'},
			{n: '9', s: 'WXYZ'},
			{n: '*'},
			{n: '0', s: '+'},
			{n: '#'}
			//{f: 'call'}
		];
		for (i = 0; i < k.length; i += 1) {
			e = document.createElement('span');
			if (k[i].f) {
				e.innerHTML = '<span class="n">&nbsp;</span><span class="s"></span>';
				e.className = k[i].f;
			} else {
				e2 = document.createElement('span');
				e2.innerHTML = k[i].n;
				e2.className = 'n';
				e3 =  document.createElement('span');
				e3.innerHTML = k[i].s || '';
				e3.className = 's';
				e.appendChild(e2);
				e.appendChild(e3);
			}
			e.addEventListener('touchstart', cb.dialerKeyDown);
			e.addEventListener('touchend', cb.dialerKeyUp);
			e.addEventListener('mousedown', cb.dialerKeyDown);
			e.addEventListener('click', cb.dialerKeyUp);
			e.addEventListener('mousemove', cb.dialerKeyMove);
			d.appendChild(e);
		}
		
		// Show UI
		document.getElementsByClassName('bottomBar')[0].style.display = 'block';
		app.emit(app.event.UI_LOAD);
		
	});
	
	return app;
}(this.app || {}, this.defaultConfig));