-----------------------------
ADMINISTRATOR NOTES
-----------------------------

Upload the entire "orca" directory to the webserver location where you
want the sample app to be accessible.

Default Settings:  Edit config.js to reflect the desired advanced 
settings. (See Advanced Settings section below.) This defines the
default settings when the user loads the page for the first time,
and the settings that are loaded when clicking "clear to default."


-----------------------------
USER INSTRUCTIONS
-----------------------------

ADVANCED SETTINGS

At the bottom of the page is a button to show/hide advanced settings.
To take effect, any new settings must be saved by clicking the "save"
button before registering.

After saving settings, they will be saved to the local storage in your
browser, so they should be remembered for next time.

To get rid of the current settings and go back to the default settings 
(what is in the config.js file) click "clear to default."

Session Config
	- Websocket URL - Must be set to the appropriate WS gateway for 
		the environment. Format: ws://server:port
	- Media Types - The call media types for the implementation. Can
		simply leave as audio,video. (Currently has no effect.)
Account
	- Set the Public ID prefix and suffix such that the Public ID
		is the correct value. For example, the prefix sip:+1
		and the suffix @example.com, will result in a Public ID
		like sip:+12223334444@example.com
	- Set the Private ID prefix and suffix similarly.
Media Options
	- STUN Server - If it is desired to use a STUN server, enter
		the URI. Otherwise, leave blank.
	- Bundle enabled - If unchecked, the line a=group:BUNDLE... will
		be removed from the SDP. If checked, the line will stay.
	- ICE Type - If set to google-ice, then Google ICE will be used.
		If blank or another value, it will not be used.
	- Crypto - If set to sdes-sbc, then the line a=crypto:0... will
		be removed from the SDP. If blank or another value, the line
		will stay.
	- Add incoming codecs - If checked, then an incoming invite with
		video that does not include VP8 will have its video codecs
        revised to be VP8, red, and ulpfec. If unchecked, then video 
        codecs will not be altered.
    - DTMF method - Specifies the DTMF method to use: sip for SIP INFO,
        inband for inband, or both for both. If blank or another value,
        then it will be set as both.
    - Refresh frame if tiled video - If checked, then force a frame
        refresh at the beginning of any call that may have tiled video.
        If unchecked, then do not force a frame refresh.
    - Audio bandwidth - Target bandwidth for audio in kilobits per
        second. If blank then no bandwidth constraint is specified.
    - Video bandwidth - Target bandwidth for video in kilobits per
        second. If blank then no bandwidth constraint is specified.
Conference Factory
	- Set the conference factory to use for conference calling.


REGISTRATION

Before attempting to register, confirm that the advanced settings
look correct.

Under the "Session" section, enter the IMS account's 10-digit 
number (example: 2223334444) and password, and click Connect to 
register.

To unregister at any time, click Disconnect.


CALLING

Under the "Call" section, enter the 10-digit number of the other 
user. Check the video checkbox for an audio+video call, or uncheck
the box for an audio-only call. Click Connect to start the call.

The other user will see a message indicating an incoming call, and 
should click either Connect (to accept) or Reject.

To end the call, click Disconnect.


CONFERENCE

Note: Conference might only work within limited conditions, depending
on the endpoints used and lab capabilities.

To initiate a conference call, enter a list of two or more users'
10-digit numbers, separated by commas (example: 2223330001,2223330002) 
then click Connect.

