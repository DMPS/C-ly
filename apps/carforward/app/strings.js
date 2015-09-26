this.app = (function (app) {
	'use strict';
	app.strings = app.strings || {};
	
	app.strings.English = {
		currentUserMessage: 'Logged in as',
		incoming: 'Incoming call from',
		forwarding: 'In Car',
		on: 'On',
		off: 'Off',
		save: 'Save',
		cancel: 'Cancel',
		login: 'Login',
		logout: 'Logout',
		call: 'Call',
		accept: 'Accept',
		reject: 'Decline',
		disconnect: 'Hang up',
		requiredField: '*Required',
		acceptCertificate: 'Please follow the link and accept the certificate for the WebRTC server',
		sessionError: 'Failed to connect to WebRTC server. Error: ',
		sessionDisconnected: 'Failed to register. Please check settings.',
		revertBeacon: 'Get original beacon settings',
		beaconProximityMessage: 'Current proximity:<br />',
		beaconNotFound: 'Not found',
		dialer: 'Dialer',
		callstatus: {
			CONNECTING: 'Connecting',
			CONNECTED: 'Connected',
			DISCONNECTED: 'Disconnected',
			ERROR: 'Error',
			INCOMING: 'Incoming',
			OUTGOING: 'Outgoing',
			REJECTED: 'Rejected',
			HOLD: 'Hold',
			REMOTE_HOLD: 'Remote hold',
			UPGRADING: 'Upgrading',
			DOWNGRADING: 'Downgrading'
		},
		form: {
			settingsform: {
				title: 'Settings',
				el: {
					name: 'My name',
					user: 'My number*',
					calling: 'Use this app for calling',
					password: 'My password',
					forwarding: ['Forwarding mode', 'None', 'Mobile', 'Car'],
					forwardto: 'Forward to car number*',
					forwardPlayMessage: 'Play message',
					beacon: 'Use beacon',
					beaconUuid: 'UUID*',
					beaconMajor: 'Major',
					beaconMinor: 'Minor',
					reset: 'Revert changes'
				}
			}
		}
	};
	
	return app;
}(this.app || {}));