var demoSession = null,
	demoCalls = [],
	currentCallId = '_new',
	notification_handler = null,
	ringtone = null,
	ringtone_caller = null,
	titleBlinkId = null,
	conferenceFactoryURI = null;

$(document).ready(function(){
	// Prepare UI when the page loads
	initSettings();
	loadSettings();
	initUI();
	sessionConnect();
	checkWSS();
});

// Reverse map an enumerated value
function generateMap(enumObj) {
	var p, map = {};
	for (p in enumObj) {
		if (enumObj.hasOwnProperty(p)) {
			map[enumObj[p]] = p;
		}
	}
	return map;
}


//=============================================================
// Session Commands
//=============================================================

function sessionConnect() {
	$('#Session0 .error').html('').hide();
	
	// Construct Session parameters
	var settings = getSettingsObject();

	// If page has just loaded and autoRegisterOnStartup is true, then proceed to auto-register.
	if (sessionConnect.firstEntry === undefined) {
		sessionConnect.firstEntry = true;
		if (!settings.other.autoRegisterOnStartup) {
			return;
		}
		console.log('Auto-Registering...');
	}

	//check browser type and validate session crypto configuration
	var valid = checkBrowserNSessionConfig(settings.sessionConfig);
	if (valid != true) {
		return;
	}
	
	$('#Session0 .sessionConnect').attr('disabled', 'disabled');

	// check and ask permission for desktop notification
	allow_desktop_notify();

	// Create Session
	demoSession = orca.createSession(settings.userid, settings.token, settings.sessionConfig);
	
	// Set Session callbacks
	addSessionCallbacks();
	
	// Connect
	demoSession.connect();
	
	// Remember user information
	saveSessionSettings();
}

function checkBrowserNSessionConfig(sessionConfig) {
	if(navigator.userAgent.match(/firefox/i)===null)
		return true;
	var Sys = {};
	getBrowserInfo(Sys);

	if (Sys.firefox && sessionConfig.providerConfig['crypto'] == 'sdes-srtp') {
		alert("Firefox does not support crypto type SDES.");
		return false;
	}
	return true;
}

function getBrowserInfo(Sys) {
    var ua = navigator.userAgent.toLowerCase();

    if (window.ActiveXObject)
        Sys.ie = ua.match(/msie ([\d.]+)/)[1];
    else if (navigator.mozGetUserMedia)
        Sys.firefox = ua.match(/firefox\/([\d.]+)/)[1];
    else if (window.MessageEvent)
        Sys.chrome = ua.match(/chrome\/([\d.]+)/)[1];
    else if (window.opera)
        Sys.opera = ua.match(/opera.([\d.]+)/)[1];
    else if (window.openDatabase)
        Sys.safari = ua.match(/version\/([\d.]+)/)[1];
}

function sessionDisconnect() {
	if (demoSession)
		demoSession.disconnect();
	close_event_notify();
	notification_handler = null;
}

function addSessionCallbacks() {
	if (demoSession) {
		demoSession.onConnected = session_onConnected;
		demoSession.onDisconnected = session_onDisconnected;
		demoSession.onError = session_onError;
		demoSession.onIncoming = session_onIncoming;
		demoSession.onIncomingPageModeChat = session_onIncomingPageModeChat;
		demoSession.onPageModeChatMessageSent = session_onPageModeChatMessageSent;
		demoSession.onPageModeChatMessageFailed = session_onPageModeChatMessageFailed;
		demoSession.onIncomingChat = session_onIncoming;
		demoSession.onIncomingFileTransfer = session_onIncoming;
		demoSession.onIncomingImageShare = session_onIncoming;
		demoSession.onStatus = session_onStatus;
	}
}

function removeSessionCallbacks() {
	if (demoSession) {
		demoSession = null;
		for (var i = 0; i < demoCalls.length; i++) {
			var call = demoCalls[i];
			if (call._state != 'disconnected') {
				removeCallCallbacks(call);
			}
		}
		updateCallTab();
	}
}

//=============================================================
// Call Commands
//=============================================================

function callConnect() {
	close_event_notify();
	if (demoSession && demoSession.getStatus() == SessionStatus.CONNECTED) {
		$('#Call0 .error').html('').hide();
		
		var call = getCall();
		if (call && call._state == 'incoming') {
			// Get user media, then accept incoming call
			$('#Call0 .buttons .callReject').removeAttr('disabled');
			var mt = call.constructor.name;
			if (mt === 'Chat' || mt === 'FileTransfer' || mt === 'ImageShare') {
				call.connect();
			} else {
				// Check if there is a current audio/video call and place it on hold if this 
				// is an audio/video call
				// Note that the hold/resume methods are only defined for an
				// audio/video call so the test on c.hold/c.resume is also a test
				// to see if a call object is audio/video as opposed to msrp.
				for (var i = 0; i < demoCalls.length; i++) {
					var c = demoCalls[i];
					if (call === '_new' || call.id() != c.id()) { // is a background call
						if (c.hold && c._state !== 'disconnected' && c._state !== 'hold' && c._state !== 'remotehold') {
							c.hold();
						}
					}
				}
				getUserMedia(call);
			}
		} else {
			// Make outgoing call
			
			// Construct Call parameters
			var callee = $('#Call0 input[name="call_to"]').val();
			var toList = getToList(callee);

			if (!toList.length) {
				alert('Please enter recipient(s)');
				$('#Call0 .buttons .callConnect').removeAttr('disabled');
				$('#Call0 .buttons .callEmptyConf').removeAttr('disabled');
				return;
			}
			
			var mediatypes = $('#Call0 input[name="mediatype"]:checked').val();
			if(!mediatypes)
				mediatypes = 'audio,video';

			callConnectOutgoing(callee, mediatypes);
			
			// Remember user information
			saveCallSettings();
			event_audio_caller("ringtone_caller.WAV", 60000);
		}
		$('#Call0 .buttons input').attr('disabled', 'disabled');
	} else {
		alert('Your Session does not appear to be connected. Cannot start communication.');
	}
}

function callConnectOutgoing(callee, mediatypes) {
	var toList = getToList(callee), call, files;
	if (!demoSession || demoSession.getStatus() !== SessionStatus.CONNECTED) {
		alert('Connect the Session first and try again.');
		return;
	}
	switch (mediatypes) {
	case 'filetransfer':
	case 'imageshare':
		files = $('#Call0 input[name="comm_file"]')[0].files;
		if (files.length) {
			if (mediatypes === 'imageshare') {
				console.log("Selected file: " + files[0].name + ", type: " + files[0].type);
				if (/image/.test(files[0].type)) {
					call = demoSession.createImageShare(toList[0], files[0]); // enforce one receiver
				} else {
					alert('Please choose an image file');
					return;
				}
			} else {
				call = demoSession.createFileTransfer(toList[0], files[0]); // enforce one receiver
			}
		} else {
			alert('Please choose a file to send');
			return;
		}
		break;
	case 'chat':
		call = demoSession.createChat(toList[0]);
		call._chatHistory = '';
		call._chatDraft = '';
		break;
	default:
		// Create Call
		call = demoSession.createCall(toList, mediatypes);
		// Check if there is a current audio/video and place it on hold if this 
		// is an audio/video call
		// Note that the hold/resume methods are only defined for an
		// audio/video call so the test on c.hold/c.resume is also a test
		// to see if a call object is audio/video as opposed to msrp.
		for (var i = 0; i < demoCalls.length; i++) {
			var c = demoCalls[i];
			if (call === '_new' || call.id() != c.id()) { // is a background call
				if (c.hold && c._state !== 'disconnected' && c._state !== 'hold' && c._state !== 'remotehold') {
					c.hold();
				}
			}
		}
	}
	call._remoteParty = callee;
	call._state = 'outgoing';
	call._isIncoming = false;
	call._type = call.constructor.name;
	if (toList.length > 1) {
		console.debug("toList.length > 1, set call._isConference to 'true'");
		call._isConference = true;
	} else if (toList[0] === conferenceFactoryURI){
		console.debug("'To' equals conferenceFactoryURI, set call._isConference to 'true'");
		call._isConference = true;
	}
	addCallTab(call);
	$('#Call0 .buttons input').attr('disabled', 'disabled');
	
	// Set Call callbacks
	addCallCallbacks(call);
	if (mediatypes === "chat" || mediatypes === "filetransfer" || mediatypes === "imageshare") {
		call.connect();
		updateCallTab(call);
	} else {
		// Get user media, then connect
		getUserMedia(call);
	}

	return call;
}

function getToList(to) {
	var puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
	var puidsuffix = getSetting('orcaMulticall.vendor.alu.account.puidSuffix') || '';
	
	//var to = $('#Call0 input[name="call_to"]').val();
	var toListRaw = to.split(',');
	var toList = [];
	for (var i=0; i < toListRaw.length; i++) {
		if (toListRaw[i].trim() !== ''){
			if(toListRaw[i].trim().indexOf(":") < 0){
				console.debug("add the prefix and suffix, the callee is: " + puidprefix + toListRaw[i].trim() + puidsuffix);
				toList.push(puidprefix + toListRaw[i].trim() + puidsuffix);
			}else{
				console.debug("needn't to add the prefix and suffix, the callee is: " + toListRaw[i].trim());
				toList.push(toListRaw[i].trim());
			}
		}
	}
	return toList;
}


function callDisconnect() {
	close_event_notify();
	var call = getCall();
	if (call) {
		call.disconnect();
	} else {
		alert('Tried to disconnect Call, but no Call was found.');
	}
}

function callReject() {
	close_event_notify();
	var call = getCall();
	if (call) {
		call.reject();
	} else {
		alert('Tried to reject Call, but no Call was found.');
	}
}

function callEmptyConf() {
	$('#Call0 input[name="call_to"]').val(conferenceFactoryURI);
	console.debug("call 'To' value is: " + $('#Call0 input[name="call_to"]').val());
	callConnect();
}

function callGetStatus() {
	var call = getCall(), message = '', status;
	if (call && call.getStatus) {
		status = call.getStatus();
		message = status ? CallStatusMap[status] : '[no status returned]';
	} else {
		message = '[no call selected]';
	}
    $('.callGetStatusDisplay').html(message);
}

function callAddParticipant() {
	var call = getCall();
	if (call) {
		var puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
		var puidsuffix = getSetting('orcaMulticall.vendor.alu.account.puidSuffix') || '';
		var num = $('#Call0 input[name="call_participant"]').val();
		call.addParticipant(puidprefix + num + puidsuffix);
	} else {
		alert('Tried to add participant to Call, but no Call was found.');
	}
}

function callRemoveParticipant() {
	var call = getCall();
	if (call) {
		var puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
		var puidsuffix = getSetting('orcaMulticall.vendor.alu.account.puidSuffix') || '';
		var num = $('#Call0 input[name="call_participant"]').val();
		call.removeParticipant(puidprefix + num + puidsuffix);
	} else {
		alert('Tried to remove participant from Call, but no Call was found.');
	}
}

function callDTMF() {
	var call = getCall();
	if (call) {
		call.sendDTMF($('#Call0 input[name="call_dtmf"]').val());
	} else {
		alert('Tried to send DTMF in Call, but no Call was found.');
	}
}

function callTransfer() {
	var call = getCall();
	if (call) {
		var puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
		var puidsuffix = getSetting('orcaMulticall.vendor.alu.account.puidSuffix') || '';
		var num = $('#Call0 input[name="call_transfer"]').val();
		call.transfer(puidprefix + num + puidsuffix);
	} else {
		alert('Tried to transfer Call, but no Call was found.');
	}
}

function callStartVideo() {
	var call = getCall();
	if (call) {
		getUserMedia(call, 'video,audio');
	} else {
		alert('Tried to upgrade to video Call, but no Call was found.');
	}
}

function callStopVideo() {
	var call = getCall();
	if (call) {
		getUserMedia(call, 'audio');
	} else {
		alert('Tried to downgrade to audio Call, but no Call was found.');
	}
}

function callMute() {
	var call = getCall();
	console.debug("Entered callMute");
	if (call) {
		call.mute('audio,video');
	} else {
		alert('Tried to mute call, but no call was found.');
	}
}

function callUnMute() {
	var call = getCall();
	console.debug("Entered callUnMute");
	if (call) {
		call.unmute('audio,video');
	} else {
		alert('Tried to unmute call, but no call was found.');
	}
}

function callRemove() {
	var call = getCall();
	if (call) {
		if (call._fileUrl) {
			window.URL.revokeObjectURL(call._fileUrl);
			call._fileUrl = null;
		}
		for (var i=0; i < demoCalls.length; i++) {
			if (demoCalls[i].id() == call.id()) {
				demoCalls.splice(i, 1);
				break;
			}
		}
		$('#Calls div[name="cid_'+call.id()+'"]').remove();
		showCallTab(demoCalls.length ? demoCalls[demoCalls.length - 1] : '_new');
	} else {
		alert('Tried to remove Call, but no Call was found.');
	}
}

function callHold() {
	var call = getCall();
	console.debug("Entered callHold"); 
	if (call) {
			call._manualHold = true;
			call.hold($('#Call0 input[name="call_hold_sendonly"]:checked').length ? 'sendonly' : 'inactive');
	} else {
			alert('Tried to hold call, but no call was found.');
	}
}

function callResume() {
	var call = getCall();
	console.debug("Entered callResume"); 
	if (call) {
			call._manualHold = false;
			call.resume();
	} else {
			alert('Tried to resume call, but no call was found.');
	}
}

function addCallCallbacks(call) {
	if (!call)
		return;
	call.onAddStream = call_onAddStream;
	call.onConnected = call_onConnected;
	call.onDisconnected = call_onDisconnected;
	call.onError = call_onError;
	call.onStatus = call_onStatus;
	call.onMessage = call_onMessage;
	call.onReceived = call_onMessage;
}

function removeCallCallbacks(call) {
	if (!call)
		return;
	call.onAddStream = function(){};
	call.onConnected = function(){};
	call.onDisconnected = function(){};
	call.onError = function(){};
	call.onStatus = function(){};
	call.onMessage = function(){};
	call._state = 'disconnected';
	if (call._remoteStreamUrl) {
		window.URL.revokeObjectURL(call._remoteStreamUrl);
		call._remoteStreamUrl = '';
	}
	call._remoteStream = null;
	removeCallLocalStream(call);
}

function removeCallLocalStream(call) {
	if (call._localStream) {
		var used = false;
		for (var i = 0; i < demoCalls.length; i++) {
			if (call.id() == demoCalls[i].id())
				continue;
			var stream = demoCalls[i]._localStream;
			if (stream && call._localStream.id == stream.id) {
				used = true;
				break;
			}
		}
		if (!used) {
			call._localStream.stop();
			call._localStream = null;
			window.URL.revokeObjectURL(call._localStreamUrl);
			call._localStreamUrl = '';
		}
	}
}

function getCall(id) {
	if (!id)
		id = currentCallId;
	else if (typeof id != 'string')
		return id;
	for (var i=0; i < demoCalls.length; i++) {
		if (demoCalls[i].id() == id)
			return demoCalls[i];
	}
}


//=============================================================
// Adding Local Stream
//=============================================================

function getUserMedia(call, mediatype) {
	console.log('getUserMedia() ' + (call ? call.id() : ''));
	if (!navigator.getUserMedia) {
		navigator.getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
		if (!navigator.getUserMedia) {
			console.warn('Your browser does not support getUserMedia');
		}
	}
	
	var audio = true;
	var video = true;
	if (call) {
		removeCallLocalStream(call);
		if (call._state == 'connected') {
			call._state = 'updatemedia';
			if(mediatype && mediatype.indexOf('video')===-1)
				video = false;
		} else {
			call._state = 'getmedia';
			var m = call.getMediaTypes();
			if (m.indexOf('video') < 0)
				video = false;
			if (m.indexOf('audio') < 0)
				audio = false;
		}
		updateCallTab(call);
	}
	
	try {
		var mediaStreamConstraints = {video: video, audio: audio};
		if(audio === false && video === false) //mediatype is null here 
			mediaStreamConstraints = {video: {
				mandatory: {
					chromeMediaSource: 'screen'
					// maxWidth: 640,
					// maxHeight: 480
				}
			}, audio: false};

		navigator.getUserMedia(
			mediaStreamConstraints, 
			function (stream) {
				onUserMediaSuccess(stream, call);
			},
			function (e) {
				onUserMediaError(call, e);
			}
		);
	} catch (e) {
		onUserMediaError(call, e);
	}
}

function onUserMediaSuccess(stream, call) {
	console.log('onUserMediaSuccess ('+stream.id+') ' + (call ? call.id() : ''));
	if (!call || (call._state != 'getmedia' && call._state != 'updatemedia'))
		return;
	call._localStreamUrl = window.URL.createObjectURL(stream);
	call._localStream = stream;
	call._localIsVideo = stream.getVideoTracks().length;
	call.addStream(stream);
	call.connect();
	if (call._state == 'getmedia') {
		call._state = call._isIncoming ? 'incoming' : 'outgoing';
	} else {
		call._state = 'connected';
	}
	updateCallTab(call);
}

function onUserMediaError(call, error) {
	console.log('onUserMediaError() ' + (call ? call.id() : '') + ' ' + error.name + ': ' + error.message);
    console.error(error);
	if (!call || (call._state != 'getmedia' && call._state != 'updatemedia')) {
		return;
    }
    if (confirm('Failed to get camera/microphone!\n' + error.name + ': ' + error.message + '\nTry again?')) {
		getUserMedia(call);
		return;
	} else {
		console.log('Failed to get camera/microphone. Disconnect the call!');
		call.disconnect();
	}
	if (call._state == 'getmedia') {
		if (call._isIncoming) {
			call.reject();
		} else {
			call.disconnect();
		}
		removeCallCallbacks(call);
		updateCallTab(call);
	}
}


//=============================================================
// Session Callbacks
//=============================================================

var SessionStatusMap = generateMap(SessionStatus);
var SessionErrorMap = generateMap(SessionError);

function showEventStr(event, map, selector) {
	if (event && (typeof event.name == 'string' || typeof event.name == 'number')) {
		var str = map[event.name];
		if (typeof str != 'string') {
			str = '[Event '+event.name+']';
		}
		$(selector).html(str);
	}
}

function session_onConnected(event) {
	console.log('session_onConnected');
	showEventStr(event, SessionStatusMap, '#Session0 .status');
	$('#Session0 .sessionDisconnect').removeAttr('disabled');
	$('#Session0 .sessionConnect').attr('disabled', 'disabled');
	$('#Session0 input[name="user_login"], #Session0 input[name="user_password"]').attr('disabled', 'disabled');
	$('#Call0 .buttons .callConnect, #Call0 .buttons .callEmptyConf').removeAttr('disabled');
	$('#PageModeChat0 .buttons .sendPageModeChatMessage, #pageModeChatSend').removeAttr('disabled');
}

function session_onDisconnected(event) {
	console.log('session_onDisconnected');
	showEventStr(event, SessionStatusMap, '#Session0 .status');
	removeSessionCallbacks();

	$('#Call0 .buttons input').attr('disabled', 'disabled');
	$('#PageModeChat0 .buttons .sendPageModeChatMessage, #pageModeChatSend').attr('disabled', 'disabled');

	resetSessionUI();
}

function session_onError(error, event) {
	console.log('session_onError '+error);
	showEventStr(event, SessionStatusMap, '#Session0 .status');
	$('#Session0 .error').html(SessionErrorMap[error] || error).show();
	removeSessionCallbacks();
	resetSessionUI();
	checkWSS();
}

function session_onIncomingPageModeChat(event) {
	console.log('session_onIncomingPageModeChat()');
	
	var caller = getNumberFromPublicID(event.from);
	//console.log("from: " + event.from + ", caller: " + caller);

	var call = null, i;
	for (i = 0; i < demoCalls.length; i++) {
		if (demoCalls[i]._remoteParty === caller && demoCalls[i]._type === 'PageModeChat') {
			call = demoCalls[i];
			break;
		}
	}
	if (call) {
		call._chatHistory += '\n-> ' +event.message;
		call._state = 'incoming';
		showCallTab(call, true);
		updateCallTab(call);
		event_notify(null, 'Incoming communication from ' + caller, 4000);
		return;
	}

	call = new PageModeChat(caller);

	call._state = 'incoming';
	call._isIncoming = true;
	call._chatHistory =  '\n-> ' + event.message;
	
	addCallTab(call);
	
	// Set Call callbacks
	addCallCallbacks(call);
	
	event_notify(null, 'Incoming communication from ' + caller, 4000);
}

function session_onPageModeChatMessageSent (event) {}


function session_onPageModeChatMessageFailed (message, event) {
	var callee = getNumberFromPublicID(event.to);
	
	var call = null, i;
	for (i = 0; i < demoCalls.length; i++) {
		if (demoCalls[i]._remoteParty === callee && demoCalls[i]._type === 'PageModeChat') {
			call = demoCalls[i];
			break;
		}
	}
	
	if (call) {
		call._chatHistory += "\nmessage [" + message + "] cannot be delivered.";
		showCallTab(call.id(), true);
	}

}


function session_onIncoming(receivedCall, event) {
	console.log('session_onIncoming');
	
	var caller = receivedCall.remoteIdentities();
	if (caller && caller.length) {
		caller = getNumberFromPublicID(caller[0].id);
	} else {
		caller = 'Unknown';
	}
	
	receivedCall._remoteParty = caller;
	receivedCall._state = 'incoming';
	receivedCall._isIncoming = true;
	receivedCall._type = receivedCall.constructor.name;
	if (receivedCall._type === 'Chat') {
		receivedCall._chatHistory = '';
		receivedCall._chatDraft = '';
	}

    if (event.fileProperties) {
        receivedCall._fileProperties = event.fileProperties;
    }
	addCallCallbacks(receivedCall);
	addCallTab(receivedCall);
	event_notify("ringtone.wav", "Incoming call from "+caller, 60000);
}

function session_onStatus(status, event) {
	console.log('session_onStatus '+status);
	showEventStr(event, SessionStatusMap, '#Session0 .status');
}


//=============================================================
// Call Callbacks
//=============================================================

var CallStatusMap = generateMap(CallStatus);
var CallErrorMap = generateMap(CallError);

function call_onAddStream(stream, event) {
	console.log('call_onAddStream ('+(stream.stream() ? stream.stream().id : 'no stream')+') '+this.id());
	this._remoteStream = stream.stream();
	this._remoteStreamUrl = window.URL.createObjectURL(this._remoteStream);
	this._remoteIsVideo = this._remoteStream.getVideoTracks().length;
	updateCallTab(this);
}

function call_onConnected(event) {
	console.log('call_onConnected '+this.id());
	this._status = event;
	this._state = 'connected';
	updateCallTab(this);
	close_event_notify();
}

function call_onDisconnected(event) {
	console.log('call_onDisconnected '+this.id());
	this._status = event;
	removeCallCallbacks(this);
	updateCallTab(this);
	close_event_notify();
}

function call_onError(error, event) {
	console.log('call_onError '+error+' '+this.id());
	this._error = CallErrorMap[error];
	removeCallCallbacks(this);
	updateCallTab(this);
	$('#Call0 .error').html(CallErrorMap[error] || error).show();

}

function call_onStatus(status, event) {
	console.log('call_onStatus '+status+' '+this.id());
	this._status = event;
	switch (status) {
	case CallStatus.REJECTED:
	case CommStatus.REJECTED:
		removeCallCallbacks(this);
		break;
	case CallStatus.UPGRADING:
		if (getSetting('orcaMulticall.vendor.alu.mediaOptions.autoUpgrade') === 'true') {
			getUserMedia(this, 'video,audio');
		} else {
			if(confirm('Allow camera/microphone for video upgrade?')){
				getUserMedia(this, 'video,audio');
			}
			else{
				callReject();
			}
		}
		break;
	case CallStatus.DOWNGRADING:
		if (getSetting('orcaMulticall.vendor.alu.mediaOptions.autoUpgrade') !== 'true') {
			alert('Video is downgraded to audio call. Please allow microphone for audio-only call!');
		}
		getUserMedia(this, 'audio');
		break;
	case CallStatus.HOLD:
		this._state = 'hold';
		break;
	case CallStatus.REMOTE_HOLD:
		this._state = 'remotehold';
		break;
	case CallStatus.UNHOLD:
		this._state = 'connected';
		break;
	case CommStatus.PROGRESS:
		this._fileProgress = event.progress;
		this._fileSize = event.size;
        break;
	case CommStatus.SENDSUCCESS:
		this._fileComplete = true;
        break;
	case CommStatus.SENDFAIL:
		break;
	}
	updateCallTab(this);
}

function call_onMessage(body) {
	var url, a;
	var self = this;
	console.log('call_onMessage, type: '+ this._type);
	if (this._type === 'Chat' || this._type === 'Call') {
		if (body instanceof Blob) {
			var messageString;
			var reader = new FileReader();
			reader.onloadend = function() {
				messageString = reader.result;
				
				if(isMessageCompositionIndication(messageString)){
					console.log("This is composition indication message, not IM message, will not render this");
					return;
				}else{		
					self._chatHistory += '\n-> ' + messageString;
					$('#dataChannelText').val(self._chatHistory);
				}
		    };
		    reader.readAsText(body);
		} else {
			var messageString = body;
			if(isMessageCompositionIndication(messageString)){
				console.log("This is composition indication message, not IM message, will not render this");
				return;
			}else{		
				self._chatHistory += '\n-> ' + messageString;
				$('#dataChannelText').val(self._chatHistory);
			}
		}
	} else {
		if (body instanceof Blob) {
    	url = window.URL.createObjectURL(body);
    	this._fileUrl = url;
    	this._fileComplete = true;
    	updateCallTab(this);
		} else {
    	console.warn('Expected Blob content from ' + this._type + '.onReceived but got ' + typeof body);
    }
	}
}

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


//=============================================================
// Settings Management
//=============================================================

function initSettings(overwrite) {
	if (localStorage && window.defaultConfig) { // See config.js
		for (var s in window.defaultConfig) {
			if (typeof window.defaultConfig[s] == 'string' && (overwrite || typeof localStorage.getItem(s) != 'string')) {
				localStorage.setItem(s, window.defaultConfig[s]);
			}
		}
	}
	// Reset recommended browser-specific setting (excluded from config.js)
	if (localStorage.getItem('orcaMulticall.vendor.alu.servContOptions.autoRegisterOnStartup') === 'false') {
		localStorage.setItem('orcaMulticall.vendor.alu.servContOptions.autoAnswerTime', '0');
	}
}

var settingsSession = [
	{ui:'user_login', storage:'orcaMulticall.user.login'},
	{ui:'user_password', storage:'orcaMulticall.user.password'}
];

var settingsCall = [
	{ui:'call_to', storage:'orcaMulticall.user.to'}
];

var settingsAdvanced = [
	{ui:'session_uri', storage:'orcaMulticall.session.sessionConfig.uri'},
	{ui:'session_mediatypes', storage:'orcaMulticall.session.sessionConfig.mediatypes', type:'radio'},
	{ui:'session_expires', storage:'orcaMulticall.vendor.alu.expires'},
	{ui:'sendAuthOnInitReg', storage:'orcaMulticall.vendor.alu.sendAuthOnInitReg', type:'checkbox'},
	{ui:'sendAuthOnReregDereg', storage:'orcaMulticall.vendor.alu.sendAuthOnReregDereg', type:'checkbox'},
	{ui:'reUseCallidInReregDereg', storage:'orcaMulticall.vendor.alu.reUseCallidInReregDereg', type:'checkbox'},
	{ui:'session_interfaceType', storage:'orcaMulticall.vendor.alu.interfaceType', type:'radio'},
	{ui:'session_authenticationType', storage:'orcaMulticall.vendor.alu.authenticationType', type:'radio'},
	{ui:'oauth_server_uri', storage:'orcaMulticall.vendor.alu.oauth_server_uri'},
	{ui:'account_realm', storage:'orcaMulticall.vendor.alu.account.realm'},
	{ui:'account_puidPrefix', storage:'orcaMulticall.vendor.alu.account.puidPrefix'},
	{ui:'account_puidSuffix', storage:'orcaMulticall.vendor.alu.account.puidSuffix'},
	{ui:'account_pridPrefix', storage:'orcaMulticall.vendor.alu.account.pridPrefix'},
	{ui:'account_pridSuffix', storage:'orcaMulticall.vendor.alu.account.pridSuffix'},
	{ui:'account_displayName', storage:'orcaMulticall.vendor.alu.account.displayName'},
	{ui:'mediaOptions_stun', storage:'orcaMulticall.vendor.alu.mediaOptions.stun'},
	{ui:'mediaOptions_bundle', storage:'orcaMulticall.vendor.alu.mediaOptions.bundle', type:'checkbox'},
	{ui:'mediaOptions_crypto', storage:'orcaMulticall.vendor.alu.mediaOptions.crypto', type:'radio'},
	{ui:'mediaOptions_addCodecs', storage:'orcaMulticall.vendor.alu.mediaOptions.addCodecs', type:'checkbox'},
	{ui:'mediaOptions_persistentPC', storage:'orcaMulticall.vendor.alu.mediaOptions.persistentPC', type:'checkbox'},
	{ui:'mediaOptions_dtmf', storage:'orcaMulticall.vendor.alu.mediaOptions.dtmf', type:'radio'},
	{ui:'mediaOptions_dtmfDuration', storage:'orcaMulticall.vendor.alu.mediaOptions.dtmfDuration'},
	{ui:'mediaOptions_dtmfGap', storage:'orcaMulticall.vendor.alu.mediaOptions.dtmfGap'},
	{ui:'mediaOptions_dtmfWorkaround', storage:'orcaMulticall.vendor.alu.mediaOptions.dtmfWorkaround', type:'checkbox'},
	{ui:'mediaOptions_audioBandwidth', storage:'orcaMulticall.vendor.alu.mediaOptions.audioBandwidth'},
	{ui:'mediaOptions_videoBandwidth', storage:'orcaMulticall.vendor.alu.mediaOptions.videoBandwidth'},
	{ui:'mediaOptions_dataBandwidth', storage:'orcaMulticall.vendor.alu.mediaOptions.dataBandwidth'},
	{ui:'mediaOptions_audioCodecs', storage:'orcaMulticall.vendor.alu.mediaOptions.audioCodecs', type:'checklist'},
	{ui:'mediaOptions_videoCodecs', storage:'orcaMulticall.vendor.alu.mediaOptions.videoCodecs', type:'checklist'},
	{ui:'mediaOptions_breaker', storage:'orcaMulticall.vendor.alu.mediaOptions.breaker', type:'checkbox'},
	{ui:'mediaOptions_stripExtraSSRC', storage:'orcaMulticall.vendor.alu.mediaOptions.stripExtraSSRC', type:'checkbox'},
	{ui:'mediaOptions_useFirstCandidate', storage:'orcaMulticall.vendor.alu.mediaOptions.useFirstCandidate', type:'checkbox'},
	{ui:'mediaOptions_removeIPV6Candidates', storage:'orcaMulticall.vendor.alu.mediaOptions.removeIPV6Candidates', type:'checkbox'},
	{ui:'mediaOptions_msidHandling', storage:'orcaMulticall.vendor.alu.mediaOptions.msidHandling'},
	{ui:'mediaOptions_enableIMDNCapability', storage:'orcaMulticall.vendor.alu.mediaOptions.enableIMDNCapability', type:'checkbox'},
	{ui:'mediaOptions_autoUpgrade', storage:'orcaMulticall.vendor.alu.mediaOptions.autoUpgrade', type:'checkbox'},
	{ui:'conferenceFactory', storage:'orcaMulticall.vendor.alu.conferenceFactory'},
	{ui:'confworkaround_chrome', storage:'orcaMulticall.vendor.alu.confWorkaroundChrome', type:'checkbox'},
	{ui:'servContOptions_autoRegisterOnStartup', storage:'orcaMulticall.vendor.alu.servContOptions.autoRegisterOnStartup', type:'checkbox'},
	{ui:'servContOptions_autoAnswerTime', storage:'orcaMulticall.vendor.alu.servContOptions.autoAnswerTime'},
	{ui:'servContOptions_maxRecoveryAttempts', storage:'orcaMulticall.vendor.alu.servContOptions.maxRecoveryAttempts'},
	{ui:'servContOptions_networkRetryInterval', storage:'orcaMulticall.vendor.alu.servContOptions.networkRetryInterval'},
	{ui:'servContOptions_sendRegisterOnRecovery', storage:'orcaMulticall.vendor.alu.servContOptions.sendRegisterOnRecovery', type:'checkbox'},
	{ui:'servContOptions_registerResponseTime', storage:'orcaMulticall.vendor.alu.servContOptions.registerResponseTime'},
	{ui:'servContOptions_registerRefreshTime', storage:'orcaMulticall.vendor.alu.servContOptions.registerRefreshTime'},
	{ui:'mdspOptions_enableMDSPsupport', storage:'orcaMulticall.vendor.alu.mdsp.enableMDSPsupport', type:'checkbox'},
	{ui:'mdspOptions_secondaryDeviceId', storage:'orcaMulticall.vendor.alu.mdsp.secondaryDeviceId'},
	{ui:'ab_ContactServer', storage:'orcaMulticall.vendor.alu.abConfig.contactServer'},
	{ui:'ab_baseAPIResPath', storage:'orcaMulticall.vendor.alu.abConfig.baseAPIResPath'},
	{ui:'sso-auth-access-type', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.accessType'},
	{ui:'sso_auth_time_zone', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.timeZone'},
	{ui:'sso_auth_app_token', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.appToken'},
	{ui:'sso_auth_operating_system', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.operatingSystem'},
	{ui:'sso_auth_operating_system_version', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.operatingSystemVersion'},
	{ui:'sso_auth_application_version', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.applicationVersion'},
	{ui:'sso_auth_service_code', storage:'orcaMulticall.vendor.alu.ssoAuthConfig.serviceCode'}
];

function loadSessionSettings(){
	loadSettingsGroup(settingsSession, '#Session0');
}

function saveSessionSettings(){
	saveSettingsGroup(settingsSession, '#Session0', true);
}

function loadCallSettings(){
	loadSettingsGroup(settingsCall, '#Call0');
}

function saveCallSettings(){
	saveSettingsGroup(settingsCall, '#Call0', true);
}

function loadAdvancedSettings(){
	loadSettingsGroup(settingsAdvanced, '#AdvancedSettings');
}

function saveAdvancedSettings(){
	saveSettingsGroup(settingsAdvanced, '#AdvancedSettings'); 
	$('#AdvancedSettings .settingsMessage').html('Saved');
	setTimeout(function(){ $('#AdvancedSettings .settingsMessage').html(''); }, 1500);
	checkWSS();
}

function revertAdvancedSettings() {
	loadAdvancedSettings();
	$('#AdvancedSettings .settingsMessage').html('Reverted');
	setTimeout(function(){ $('#AdvancedSettings .settingsMessage').html(''); }, 1500);
}

function clearAdvancedSettings() {
	initSettings(true);
	loadAdvancedSettings();
	$('#AdvancedSettings .settingsMessage').html('Cleared to default');
	setTimeout(function(){ $('#AdvancedSettings .settingsMessage').html(''); }, 1500);
}

function loadSettings() {
	loadAdvancedSettings();
	loadSessionSettings();
	loadCallSettings();
}

function loadSettingsGroup(settings, selector) {
	if (!selector)
		selector = 'body';
	var container = $(selector);
	for (var i=0; i<settings.length; i++) {
		if (localStorage)
			var value = localStorage.getItem(settings[i].storage);
		else if (window.defaultConfig)
			var value = window.defaultConfig[settings[i].storage];
		else
			break;
		loadSettingsUnit(settings[i], value, container);
	}
}

function loadSettingsUnit(setting, value, container) {
	if (!container.length)
		container = $('body');
	var node = container.find('[name="'+setting.ui+'"]');
	if (!node.length)
		return;
	switch (setting.type) {
	case 'checklist':
		var vals = [''], i, n, unused = '';
		if (typeof value === 'string') {
			vals = value.replace(/\s*(,+\s*)+/g, ',').replace(/^,|,$|^\s+|\s+$/g, '').split(',');
		}
		node.prop('checked', false).removeAttr('checked');
		if (vals[0] !== '') {
			for (i = 0; i < vals.length; i += 1) {
				n = node.filter('[value="' + vals[i] + '"][type!="text"]');
				if (n.length > 0) {
					n.prop('checked', true).attr('checked','checked');
				} else {
					unused += ',' + vals[i];
				}
			}
			node.filter('[type="text"]').val(unused.replace(/^,/, ''));
			container.find('[name="' + setting.ui + '_toggle"]')
					.prop('checked', true).attr('checked','checked')
					.parent().parent().next().show();
		} else {
			node.filter('[type="text"]').val('');
			container.find('[name="' + setting.ui + '_toggle"]')
					.prop('checked', false).removeAttr('checked')
					.parent().parent().next().hide();
		}
		break;
	case 'checkbox':
		if (value == 'true') {
			node.prop('checked', true);
			node.attr('checked','checked');
		} else {
			node.prop('checked', false);
			node.removeAttr('checked');
		}
		break;
	case 'radio':
		for(var i=0; i<node.length; i++){
			if($(node[i]).val() == value){
				$(node[i]).prop('checked', true);
				$(node[i]).attr('checked', 'checked');
			}else{
				$(node[i]).prop('checked', false);
			    $(node[i]).removeAttr('checked');

			}
		}
		break;
	default: //text
		if (typeof value == 'string')
			node.val(value);
		else
			node.val('');
	}
}

function saveSettingsGroup(settings, selector, suppressWarning) {
	if (!localStorage) {
		if (!suppressWarning) {
			alert('Save Failed! '+
				  'Local Storage is required to save custom settings. '+
				  'Enable Local Storage in your browser settings '+
				  'or upgrade to a browser which supports it.');
		}
		return;
	}
	if (!selector)
		selector = 'body';
	var container = $(selector);
	for (var i=0; i<settings.length; i++) {
		saveSettingsUnit(settings[i], container);
	}
}

function saveSettingsUnit(setting, container) {
	if (!localStorage)
		return;
	if (!container.length)
		container = $('body');
	var node = container.find('[name="'+setting.ui+'"]');
	if (!node.length)
		return;
	var value = null;
	switch (setting.type) {
	case 'checklist':
		var i, n = container.find('[name="' + setting.ui + '_toggle"]');
		value = '';
		if (n.length < 1 || n.is(':checked')) {
			for (var i = 0; i < node.length; i += 1) {
				if ($(node[i]).is(':checked,[type="text"]')) {
					value += ',' + $(node[i]).val();
				}
			}
			value = value.replace(/\s*(,+\s*)+/g, ',').replace(/^,|,$|^\s+|\s+$/g, '');
		}
		break;
	case 'checkbox':
		if (node.is(':checked'))
			value = 'true';
		else
			value = 'false';
		break;
	case 'radio':
		value = "";
		for(var i=0; i<node.length; i++){

			if($(node[i]).is(':checked')){
				value = $(node[i]).val();
			}
		}
		break;
	default: //text
		value = node.val();
	}
	localStorage.setItem(setting.storage, value);
}

function getSetting(storageField) {
	if (localStorage)
		return localStorage.getItem(storageField);
	else if (window.defaultConfig)
		return window.defaultConfig[storageField];
	else
		return null;
}

function getSettingsObject() {
	var settings = {};
	var uri = getSetting('orcaMulticall.session.sessionConfig.uri');
	
	if ((uri.indexOf("ws:") < 0) && (uri.indexOf("wss:") < 0)) {
		console.warn("The Websocket URL sheme should be 'ws' or 'wss', the input is: " + uri);
		return null;
	}
	
	var uriRaw = uri.split(":");
	var uriScheme = uriRaw[0];
	var uriAddress = uriRaw[1];
	var uriPort;
	if(uriRaw.length > 2){
		uriPort = uriRaw[2];
	}
	console.debug("uriScheme is: " + uriScheme + ", uriAddress is: " + uriAddress + ", uriPort is: " + uriPort);
	
	if(uriScheme === "ws" && !uriPort){
		uri = uri + ":80";
		console.debug("use default port 80 for the ws, the whole URL is: " + uri);
		window.alert("Will use default port '80' for the 'Websocket URL', the URL is: " + uri);
	}
	
	if(uriScheme === "wss" && !uriPort){
		uri = uri + ":443";
		console.debug("use default port 443 for the wss, the whole URL is: " + uri);
		window.alert("Will use default port '443' for the 'Websocket URL', the URL is: " + uri)
	}
	
	var mediatypes = getSetting('orcaMulticall.session.sessionConfig.mediatypes') || 'audio,video';
	var puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
	var puidsuffix = getSetting('orcaMulticall.vendor.alu.account.puidSuffix') || '';
	var pridprefix = getSetting('orcaMulticall.vendor.alu.account.pridPrefix') || '';
	var pridsuffix = getSetting('orcaMulticall.vendor.alu.account.pridSuffix') || '';
	var displayName = getSetting('orcaMulticall.vendor.alu.account.displayName') || '';
	var interfacetype = getSetting('orcaMulticall.vendor.alu.interfaceType') || 'SIP-WS';
	var oAuthServerURL = getSetting('orcaMulticall.vendor.alu.oauth_server_uri');
	var login = $('#Session0 input[name="user_login"]').val();
	var password = $('#Session0 input[name="user_password"]').val();
	
	settings.userid = puidprefix + login + puidsuffix;
	settings.token = {
		id: pridprefix + login + pridsuffix,
		key: password,
		displayName: displayName
	};
	
	var sendAuthOnInitReg = getSetting('orcaMulticall.vendor.alu.sendAuthOnInitReg') === 'true' ? true : false;
	var sendAuthOnReregDereg = getSetting('orcaMulticall.vendor.alu.sendAuthOnReregDereg') === 'true' ? true : false;
	var reUseCallidInReregDereg = getSetting('orcaMulticall.vendor.alu.reUseCallidInReregDereg') === 'true' ? true : false;
	var stun = getSetting('orcaMulticall.vendor.alu.mediaOptions.stun') || '';
	var bundle = getSetting('orcaMulticall.vendor.alu.mediaOptions.bundle') === 'true' ? true : false;
	var crypto = getSetting('orcaMulticall.vendor.alu.mediaOptions.crypto') || '';
	conferenceFactoryURI = getSetting('orcaMulticall.vendor.alu.conferenceFactory') || '';
	var expires = getSetting('orcaMulticall.vendor.alu.expires') || '';
	var addCodecs = getSetting('orcaMulticall.vendor.alu.mediaOptions.addCodecs') === 'true' ? true : false;
	var dtmf = getSetting('orcaMulticall.vendor.alu.mediaOptions.dtmf') || 'inband';
	var dtmfDuration = getSetting('orcaMulticall.vendor.alu.mediaOptions.dtmfDuration') || '';
	var dtmfGap = getSetting('orcaMulticall.vendor.alu.mediaOptions.dtmfGap') || '';
	var dtmfWorkaround = getSetting('orcaMulticall.vendor.alu.mediaOptions.dtmfWorkaround') === 'true' ? true : false;
	var audioBandwidth = getSetting('orcaMulticall.vendor.alu.mediaOptions.audioBandwidth') || '';
	var videoBandwidth = getSetting('orcaMulticall.vendor.alu.mediaOptions.videoBandwidth') || '';
	var dataBandwidth = getSetting('orcaMulticall.vendor.alu.mediaOptions.dataBandwidth') || '';
	var audioCodecs = getSetting('orcaMulticall.vendor.alu.mediaOptions.audioCodecs') || '';
	var videoCodecs = getSetting('orcaMulticall.vendor.alu.mediaOptions.videoCodecs') || '';
	var breaker = getSetting('orcaMulticall.vendor.alu.mediaOptions.breaker') === 'true' ? true : false;
	var stripExtraSSRC = getSetting('orcaMulticall.vendor.alu.mediaOptions.stripExtraSSRC') === 'true' ? true : false;
	var useFirstCandidate = getSetting('orcaMulticall.vendor.alu.mediaOptions.useFirstCandidate') === 'true' ? true : false;
	var removeIPV6Candidates = getSetting('orcaMulticall.vendor.alu.mediaOptions.removeIPV6Candidates') === 'true' ? true : false;
	var msidHandling = getSetting('orcaMulticall.vendor.alu.mediaOptions.msidHandling') || '0';
	var enableIMDNCapability = getSetting('orcaMulticall.vendor.alu.mediaOptions.enableIMDNCapability') === 'true' ? true : false;
	var confWorkaroundChrome = getSetting('orcaMulticall.vendor.alu.confWorkaroundChrome') === 'true' ? true : false;
	var autoRegisterOnStartup = getSetting('orcaMulticall.vendor.alu.servContOptions.autoRegisterOnStartup') === 'true' ? true : false;
	var autoAnswerTime = getSetting('orcaMulticall.vendor.alu.servContOptions.autoAnswerTime') || '';
	var maxRecoveryAttempts = getSetting('orcaMulticall.vendor.alu.servContOptions.maxRecoveryAttempts') || '';
	var networkRetryInterval = getSetting('orcaMulticall.vendor.alu.servContOptions.networkRetryInterval') || '';
	var sendRegisterOnRecovery = getSetting('orcaMulticall.vendor.alu.servContOptions.sendRegisterOnRecovery') === 'true' ? true : false;
	var registerResponseTime = getSetting('orcaMulticall.vendor.alu.servContOptions.registerResponseTime') || '';
	var registerRefreshTime = getSetting('orcaMulticall.vendor.alu.servContOptions.registerRefreshTime') || '';
	var enableMDSPsupport = getSetting('orcaMulticall.vendor.alu.mdsp.enableMDSPsupport') === 'true' ? true : false;
	var secondaryDeviceId = getSetting('orcaMulticall.vendor.alu.mdsp.secondaryDeviceId') || '';
	var contactServerURI = getSetting('orcaMulticall.vendor.alu.abConfig.contactServer') || '';
	var baseResourcePath = getSetting('orcaMulticall.vendor.alu.abConfig.baseAPIResPath') || '';
    var crlfKeepAliveInterval = getSetting('orcaMulticall.vendor.alu.crlfKeepAliveInterval') || '';

	settings.sessionConfig = {
		uri: uri,
		provider: orcaALU,
		mediatypes: mediatypes,
		providerConfig: {
			interfaceType: interfacetype,
			sendAuthOnInitReg: sendAuthOnInitReg,
			sendAuthOnReregDereg: sendAuthOnReregDereg,
			reUseCallidInReregDereg: reUseCallidInReregDereg,
			stun: stun,
			bundle: bundle,
			crypto: crypto,
			conferenceFactoryURI: conferenceFactoryURI,
			expires: expires,
			addCodecs: addCodecs,
			dtmf: dtmf,
			dtmfDuration:dtmfDuration,
			dtmfGap:dtmfGap,
			dtmfWorkaround: dtmfWorkaround,
			audioBandwidth: audioBandwidth,
			videoBandwidth: videoBandwidth,
			dataBandwidth: dataBandwidth,
			audioCodecs: audioCodecs,
			videoCodecs: videoCodecs,
			breaker: breaker,
			stripExtraSSRC: stripExtraSSRC,
			useFirstCandidate: useFirstCandidate,
			removeIPV6Candidates: removeIPV6Candidates,
			enableIMDNCapability: enableIMDNCapability,
			msidHandling: msidHandling,
			confWorkaroundChrome: confWorkaroundChrome,
			autoAnswerTime: autoAnswerTime,
			maxRecoveryAttempts: maxRecoveryAttempts,
			networkRetryInterval: networkRetryInterval,
			sendRegisterOnRecovery: sendRegisterOnRecovery,
			registerResponseTime: registerResponseTime,
			registerRefreshTime: registerRefreshTime,
			enableMDSPsupport: enableMDSPsupport,
			secondaryDeviceId: secondaryDeviceId,
			crlfKeepAliveInterval: crlfKeepAliveInterval
		}
	};
	
	settings.abConfig = {
		provider: orcaALU,
		contactServerURI: contactServerURI,
		baseResourcePath: baseResourcePath		
	};
	
	settings.other = {
		autoRegisterOnStartup: autoRegisterOnStartup
	};
	
	return settings;
}


//=============================================================
// UI
//=============================================================

function initUI() {
	// If container app, load Cordova
	if (!navigator.getUserMedia && navigator.userAgent.match(/Android|iPad|iPhone|iPod/i)) {
		$('head').append('<script type="text/javascript" src="../../cordova.js"></script>');
		$('body').prepend('<a href="javascript:history.back()">Back</a>');
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

	$('#Session0 .sessionConnect').click(sessionConnect);
	$('#Session0 .sessionDisconnect').click(sessionDisconnect);
	$('#Session0 input[name="user_login"]').change(function(){
		$('#AdvancedSettings .userLogin').html($(this).val());
	});
	$('#Call0 .callConnect').click(callConnect);
	$('#Call0 .callDisconnect').click(callDisconnect);
	$('#Call0 .callReject').click(callReject);
	$('#Call0 .callEmptyConf').click(callEmptyConf);
	$('#Call0 .callAddParticipant').click(callAddParticipant);
	$('#Call0 .callRemoveParticipant').click(callRemoveParticipant);
	$('#Call0 .callDTMF').click(callDTMF);
	$('#Call0 .callTransfer').click(callTransfer);
	$('#Call0 .callMute').click( function() {
		if ( $(this).attr('value') == 'Mute')
		{
			$(this).attr('value', 'Un-Mute');
			callMute();
		}
		else
		{
			$(this).attr('value', 'Mute');
			callUnMute();
		} 
	});
	$('#Call0 .callHold').click( function() {
		if ( $(this).attr('value') == 'Hold')
		{
			$(this).attr('value', 'Resume');
			callHold();
		}
		else
		{
			$(this).attr('value', 'Hold');
			callResume();
		} 
	});
	$('#Call0 .callStartVideo').click(callStartVideo);
	$('#Call0 .callStopVideo').click(callStopVideo);
	$('#Call0 .callRemove').click(callRemove);
	$('#Call0 .pageModeChatRemove').click(callRemove);
	$('#Call0 input[name="call_video"]').attr('checked','checked');
	$('#AdvancedSettings .settingsSave').click(saveAdvancedSettings);
	$('#AdvancedSettings .settingsRevert').click(revertAdvancedSettings);
	$('#AdvancedSettings .settingsClear').click(clearAdvancedSettings);
	$('#AdvancedSettings .userLogin').html($('#Session0 input[name="user_login"]').val());
	$('#AdvancedSettings .checklistToggle').change(function () {
		var expandable = $(this).parent().parent().next(),
			checkboxes = expandable.find('input');
		if ($(this).is(':checked')) {
			expandable.show();
			if (!checkboxes.is(':checked')) {
				checkboxes.prop('checked', true).attr('checked','checked');
			}
		} else {
			expandable.hide();
		}
	});

	$('.error').click(function(){ $(this).hide(); }).hide();
	$('.prompt').click(function(){ $(this).hide(); }).hide();
	$('.expander').click(function(){
		$(this).toggleClass('selected').next().toggle(); 
	});
	$('.expandable').hide();
	$('#Call0 .removePageModeChat').hide();
	
	$('.sendMessage').click(sendMessage);
	$('.clearMessage').click(function() {
		$('#dataChannelText').val("");
		var call = getCall();
		if (call) {
			call._chatHistory = "";
		}
	});

	$('#PageModeChat0 p').click(function() {
		var call = getCall();
		if (call && call._state && call._state === 'incoming') {
			call._state = 'received';
			updateCallTab(call);
		}
	});
	
	$('.sendPageModeChatMessage').click(sendPageModeChatMessage);
	$('.clearPageModeChatMessage').click(function() {
		$('#pageModeChatText').val("");
		var call = getCall();
		if (call) {
			call._chatHistory = "";
		}
	});

	$('#Call0 input[name="mediatype"]').click(showNewMediaType);

	$('#dataChannelSend').keypress(function (evt) {
		if (evt.keyCode !== 13 || !this.value) {
			var call = getCall();
			if (call) {
				call._chatDraft = $('#dataChannelSend').val();
			}
			return;
		}
		sendMessage();
		return false;
	});
	$('#pageModeChatSend').keypress(function (evt) {
		if (evt.keyCode !== 13 || !this.value) {
			return;
		}
		sendPageModeChatMessage();
		return false;
	});


	setInterval(callGetStatus, 200); //Keep polling the result of getStatus

	$('#PageModeChat0 .buttons .sendPageModeChatMessage').attr('disabled', 'disabled');
	$('#pageModeChatSend').attr('disabled', 'disabled');

	resetSessionUI();
	showCallTab('_new');
	listenCallTabs();
}

function resetSessionUI() {
	$('#Session0 .sessionConnect').removeAttr('disabled');
	$('#Session0 .sessionDisconnect').attr('disabled', 'disabled');
	$('#Session0 input[name="user_login"], #Session0 input[name="user_password"]').removeAttr('disabled');
}

function showNewMediaType() {
	var el = $('#Call0 [name="mediatype"]');
	if (el.is('[value="pagemodechat"]:checked')) {
		$('#PageModeChat0').show();
		$('#Call0 .callState').hide().filter('.idle').show();
		$('#Call0 .fileTransferOnly').hide();
		$('#Call0 .buttons').hide();
		$('#Call0 .getCallStatus').hide();
		$('#pageModeChatText').val('');
		$('#pageModeChatSend').val('');
	} else if (el.is('[value="filetransfer"]:checked') || el.is('[value="imageshare"]:checked')) {
		$('#Call0 .fileTransferOnly').show();
		$('#PageModeChat0').hide();
		$('#Call0 .buttons').show();
	} else {
		$('#Call0 .fileTransferOnly').hide();
		$('#PageModeChat0').hide();
		$('#Call0 .buttons').show();
	}
}

function showCallTab(call, isUpdate) {
	$('#Call0 .buttons').show();
	if (call === '_new') {
		currentCallId = '_new';
		$('#Call0 .status').html('');
		$('#Call0 .callState').hide().filter('.idle').show();
		$('#Call0 .callParticipants').empty();
		$('#Call0 .buttons input').attr('disabled', 'disabled');
		if (demoSession && demoSession.getStatus() == SessionStatus.CONNECTED) {
			$('#Call0 .buttons .callConnect').removeAttr('disabled');
			$('#Call0 .buttons .callEmptyConf').removeAttr('disabled');
		}
		$('#Calls div').removeClass('current').filter('[name="cid__new"]').addClass('current');
		$('#Video0 .localVideo').attr('src', '').hide();
		$('#Video0 .remoteVideo').attr('src', '').hide();
		$('#Video0 .remoteAudio').attr('src', '');
		$('#Data0,#PageModeChat0,#File0,#Image0,#Call0 .fileTransferOnly,#Call0 .removePageModeChat').hide();
		if ($('#Call0 input[name="mediatype"][value="filetransfer"]').is(':checked') ||
			$('#Call0 input[name="mediatype"][value="imageshare"]').is(':checked')) {
			$('#Call0 .fileTransferOnly').show();
		}
		if ($('#Call0 input[name="mediatype"][value="pagemodechat"]').is(':checked')) {
			$('#pageModeChatText').val('');
			$('#pageModeChatSend').val('');
			$('#PageModeChat0').show();
			$('#Call0 .buttons').hide();
		}
	} else {
		call = getCall(call);
		if (!call)
			return;
		var mt = call._type;
		currentCallId = call.id();
		showEventStr(call._status, CallStatusMap, '#Call0 .status');
		$('#Call0 .callState').hide().filter('.' + call._state).show();
		if (!call._isConference)
			$('#Call0 .callState.conference').hide();
		$('#Call0 .callParticipants').html(call._remoteParty);
		$('#Call0 .callHold').attr('value', call._state == 'hold' ? 'Resume' : 'Hold');
		$('#Call0 .callMute').attr('value', isMuted(call) ? 'Un-Mute' : 'Mute');
		switch (call._state) {
		case 'connected':
		case 'outgoing':
		case 'hold':
		case 'remotehold':
			$('#Call0 .buttons input').attr('disabled', 'disabled').filter('.callDisconnect').removeAttr('disabled');
			break;
		case 'incoming':
			$('#Call0 .buttons input').removeAttr('disabled').filter('.callDisconnect').attr('disabled', 'disabled');
			if (call._fileProperties) {
				$('#Call0 .incomingFileInfo').html('<br />Name: ' + call._fileProperties.name + '<br />Size: ' + call._fileProperties.size + '<br />Type: ' + call._fileProperties.type);
			} else {
				$('#Call0 .incomingFileInfo').html('');
			}
			break;
		case 'getmedia':
		case 'updatemedia':
		case 'disconnected':
			$('#Call0 .buttons input').attr('disabled', 'disabled');
			break;
		}
		$('#Calls div').removeClass('current').filter('[name="cid_'+call.id()+'"]').addClass('current');
		if (call._remoteIsVideo && call._remoteStream) {
			$('#Video0 .remoteVideo').attr('src', call._remoteStreamUrl).show();
			$('#Video0 .remoteAudio').attr('src', '');
		} else {
			$('#Video0 .remoteVideo').attr('src', '').hide();
			$('#Video0 .remoteAudio').attr('src', call._remoteStreamUrl);
		}
		if (call._localIsVideo && call._localStream) {
			$('#Video0 .localVideo').attr('src', call._localStreamUrl).show();
		} else {
			$('#Video0 .localVideo').attr('src', '').hide();
		}
		if (mt !== 'Call') {
			$('.msrpUnnecessary').hide();
		}
		$('#Data0,#File0').hide();
		$('#Data0,#Image0').hide();
		$('#PageModeChat0').hide();
		$('#Call0 .removePageModeChat').hide();
		if (mt === 'Chat') {
			$('#Data0').show();
			if (call._state === 'incoming' || call._state === 'outgoing') {
				$('#dataChannelSend').val('');
				$('#dataChannelText').val('');
			} else {
				$('#dataChannelSend').val(call._chatDraft);
				$('#dataChannelText').val(call._chatHistory);
			}
		} else if (mt === 'PageModeChat') {
			$('#Call0 .callState').hide();
			$('#Call0 .getCallStatus').hide();
			$('#Call0 .buttons').hide();
			$('#PageModeChat0').show();
			$('#Call0 .removePageModeChat').show();

			$('#pageModeChatSend').val(call._chatDraft);
			$('#pageModeChatText').val(call._chatHistory);

		} else if (mt === 'FileTransfer') {
			$('#File0').show();
			$('#File0 .fileProgress').html(call._fileProgress || '0');
			$('#File0 .fileSize').html(call._fileSize || '0');
			$('#File0 .fileIncoming, #File0 .fileOutgoing').hide();
			if (call._isIncoming) {
			    $('#File0 .fileIncoming').show();
			} else {
			    $('#File0 .fileOutgoing').show();
			}
			$('#File0 .fileComplete').hide();
			if (call._fileComplete) {
			    $('#File0 .fileComplete').show();
			}
			$('#File0 .fileLink').hide();
			if (call._fileUrl) {
				$('#File0 .fileLink').show();
				a = $('#File0 .fileLink')[0];
				a.href = call._fileUrl;
				a.target = '_blank';
				if (call._fileProperties && call._fileProperties.name) {
					a.download = call._fileProperties.name;
				} else {
					a.download = 'file';
				}
			}
		} else if (mt === 'ImageShare') {
			$('#Image0').show();
			$('#Image0 .imageProgress').html(call._fileProgress || '0');
			$('#Image0 .imageSize').html(call._fileSize || '0');
			$('#Image0 .imageIncoming, #Image0 .imageOutgoing').hide();
			if (call._isIncoming) {
				$('#Image0 .imageIncoming').show();
			} else {
				$('#Image0 .imageOutgoing').show();
			}
			$('#Image0 .imageComplete').hide();
			$('#Image0 .imageLink').hide();
			if (call._fileComplete) {
				$('#Image0 .imageComplete').show();
			}
			if (call._fileUrl) {
				$('#Image0 .imageLink').show();
				a = $('#Image0 .imageLink')[0];
				a.href = call._fileUrl;
				a.target = '_blank';
				img = $('#Image0 .imageLink .imageIcon')[0];
				img.src = call._fileUrl;
				if (call._fileProperties && call._fileProperties.name) {
				    a.download = call._fileProperties.name;
				} else {
				    a.download = 'file';
				}
			}
		}
	}
		
	if (!isUpdate) {
		for (var i = 0; i < demoCalls.length; i++) {
			var c = demoCalls[i];
			if ( call != '_new' &&  call.id() != c.id() && mt == 'Call' ) {
				// This is a background audio/video call, put it on hold.  Note that
				// if the new call is a new tab, we wait until callConnect to determine the
				// type before placing a background audio/video call on hold.
				// Note that the hold/resume methods are only defined for an
				// audio/video call so the test on c.hold/c.resume is also a test
				// to see if a call object is audio/video as opposed to msrp.
				if (c.hold && c._state === 'connected') {
					c.hold();
				}
			} else if (c.resume && c._state == 'hold' && !c._manualHold) { 
				// Resume the foreground call
				c.resume();
			}
		}
	}
}

function addCallTab(call) {
	demoCalls.push(call);
	$('#Calls').append('<div name="cid_'+call.id()+'">'+call._type+' with '+call._remoteParty+'</div>');
	listenCallTabs();
	updateCallTab(call);
	var current = getCall();
	if (!current || current._state == 'disconnected') {
		showCallTab(call);
	}
}

function updateCallTab(call) {
	var call = getCall(call);
	if (!call)
		return;
	if (call.id() == currentCallId) {
		showCallTab(call, true);
	}
	$('#Calls div[name="cid_'+call.id()+'"]').removeClass('incoming disconnected');
	if (call._state == 'incoming' || call._state == 'disconnected') {
		$('#Calls div[name="cid_'+call.id()+'"]').addClass(call._state);
	}
}

function listenCallTabs() {
	$('#Calls div').off('click').on('click', function () {
		var id = $(this).attr('name');
		if (id) {
			var callId = id.replace(/^cid_/, '');
			showCallTab(callId);
			var call = getCall(callId);
			if (call && call._type === 'PageModeChat' && call._state === 'incoming') {
				call._state = 'connected';
				updateCallTab(call);
			}
		}
	});
}

function title_blink(msg) {
	var oldTitle = document.title;
	var blink = function() { document.title = document.title == msg ? '-' : msg; };
	var timeoutId = setInterval(blink, 1000);
	return timeoutId+','+oldTitle; // blinkId to stop blinking and restore title.
};

function stop_title_blink(blinkId) {
	if(blinkId===null)
		return;
	var temp = blinkId.split(',');
	clearInterval(temp[0]);
	document.title = temp[1];
};

function event_notify(audioClip, notifyText, timeout){
	if(audioClip !== null){
		ringtone = new Audio(audioClip);

		ringtone.type = "audio/x-wav" ;
		ringtone.count = 1 ;
		ringtone.addEventListener ('ended', function() {
	  		this.count = this.count + 1 ;
	  		if(this.count > 4) {
	  			console.log("Done playing") ;
		  	} else {
	  			console.log("loop #:" + this.count) ;
	  			this.play() ;
	  		}
		} , false) ;
		ringtone.play();
	}

	if(notifyText !== null){
		if(window.webkitNotifications){
			 notification_handler = window.webkitNotifications.createNotification('orca_alu.jpg', 'ORCA', notifyText);
			 notification_handler.display = function() {}
			 notification_handler.onerror = function() {}
			 notification_handler.onclose = function() {}
			 notification_handler.onclick = function() {this.cancel();}
			 
			 notification_handler.replaceId = 'orca_multicall';
			 notification_handler.show();
		}
		titleBlinkId = title_blink(notifyText);
	}
	if(timeout)
		window.setTimeout(close_event_notify, timeout);
}

function event_audio_caller(audioClip, timeout){
	if(audioClip !== null){
		ringtone_caller = new Audio(audioClip);
	}
	ringtone_caller.loop = true;
	ringtone_caller.play();
	if(timeout)
		window.setTimeout(close_event_notify, timeout);
}

function close_event_notify(){
	if(ringtone){
		ringtone.pause();
	}
	if(ringtone_caller){
		ringtone_caller.pause();
	}
	if(notification_handler)
		notification_handler.cancel();
	stop_title_blink(titleBlinkId);
	titleBlinkId = null;
}

function allow_desktop_notify() {
	if(!window.webkitNotifications)
		return;
	if(window.webkitNotifications.checkPermission() === 0){
		console.log('Notification allowed.');
	} else {
		console.log('Notification not allowed!');
		//alert('Notification permission failed!');
		window.webkitNotifications.requestPermission(allow_desktop_notify);
	}
}

function isMuted(call) {
	var tracks;
	// TODO case where audio and video can be muted independently
	if (call._localStream) {
		tracks = call._localStream.getAudioTracks();
		if (tracks.length && !tracks[0].enabled) {
			return true;
		}
		tracks = call._localStream.getVideoTracks();
		if (tracks.length && !tracks[0].enabled) {
			return true;
		}
	}
	return false;
}

function sendMessage() {
	var call = getCall();
	if (call && call._type === 'Chat') {
		if($('#dataChannelSend').val() == ""){
			console.log('empty string is not allowed to be sent');
			return;
		}
		
		call.sendMessage($('#dataChannelSend').val());
		call._chatHistory += '\nI: '+ $('#dataChannelSend').val();
		$('#dataChannelText').val(call._chatHistory);
		call._chatDraft = '';
		$('#dataChannelSend').val('');
	} else {
		console.warn('No Call or data channel was found.');
	}
}

function sendPageModeChatMessage() {
	console.log("application sendPageModeChatMessage.");
	var call, i;
	
	var messageToSend = $('#pageModeChatSend').val();

	var foundExistingChat = false;
	var toList;
	var call = getCall();
	if (call) {
		foundExistingChat = true;
		toList = getToList(call._remoteParty);
	} else {
		var callee = $('#Call0 input[name="call_to"]').val();
		toList = getToList(callee);
		if (!toList.length) {
			alert('Please enter recipient(s)');
			return;
		}

		for (i = 0; i < demoCalls.length; i++) {
			if (demoCalls[i]._remoteParty === callee && demoCalls[i]._type === 'PageModeChat'){
				call = demoCalls[i];
				foundExistingChat = true;
				break;
			}
		}
		if (i == demoCalls.length) {
			call = new PageModeChat(callee);
	
			call._state = 'outgoing';
			call._isIncoming = false;
	
			// Set Call callbacks
			addCallCallbacks(call);

			// Remember user information
			saveCallSettings();
		}
	}
	
	call._chatHistory += '\nI: '+ $('#pageModeChatSend').val();
	
	if (foundExistingChat) {
		showCallTab(call.id(), true);
	} else {
		addCallTab(call);
	}
	
	demoSession.sendPageModeChatMessage(toList, messageToSend);
}

function PageModeChat(to) {
	this._chatHistory = '';
	this._chatDraft = '';
	this._type = 'PageModeChat';
	this._remoteParty = to;
	
    this.id = function () {
        return this._remoteParty;
    };

}

function getNumberFromPublicID(address) {
	// Get number from public ID
	// If it matches the Public ID Prefix, then return everything after the prefix and before the @ character.
	// If it matches the Public ID Prefix if "sip:" is replaced with "tel:" or vice versa, then same behavior.
	// Otherwise return everything before the @ character.
	var start, end, unknown = 'Unknown',
		puidprefix = getSetting('orcaMulticall.vendor.alu.account.puidPrefix') || '';
	if (typeof address !== 'string') {
		return unknown;
	}
	start = address.indexOf(puidprefix);
	if (start < 0) {
		start = address.replace('tel:', 'sip:').indexOf(puidprefix);
		if (start < 0) {
			start = address.replace('sip:', 'tel:').indexOf(puidprefix);
		}
		if (start < 0) {
			start = 0;
		} else {
			start += puidprefix.length;
		}
	} else {
		start += puidprefix.length;
	}
	end = address.indexOf('@');
	if (end < 0) {
		end = address.length;
	}
	return address.substring(start, end) || unknown;
}

function checkWSS() {
	// Prompt to accept certificate
	var ws, id, server;
	id = 'WebSocketCertificatePrompt';
	server = getSetting('orcaMulticall.session.sessionConfig.uri');
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
