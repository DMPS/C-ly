window.defaultConfig = {

// Session parameters
'orcaMulticall.session.sessionConfig.uri': 'ws://10.1.11.127:80',
'orcaMulticall.session.sessionConfig.mediatypes': 'audio',


// Vendor parameters
'orcaMulticall.vendor.alu.account.puidPrefix': 'sip:',
'orcaMulticall.vendor.alu.account.puidSuffix': '@sandbox.demo.alcatel-lucent.com',
'orcaMulticall.vendor.alu.account.pridPrefix': '',
'orcaMulticall.vendor.alu.account.pridSuffix': '',
'orcaMulticall.vendor.alu.account.displayName': '',
'orcaMulticall.vendor.alu.interfaceType': 'SIP-WS',
'orcaMulticall.vendor.alu.authenticationType': 'IMS-Auth',
'orcaMulticall.vendor.alu.mediaOptions.stun': '',
'orcaMulticall.vendor.alu.mediaOptions.bundle': 'false', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.crypto': 'dtls-srtp', //'dtls-srtp' or 'sdes-srtp' by default
'orcaMulticall.vendor.alu.conferenceFactory': 'sip:ALU_CONF@sandbox.demo.alcatel-lucent.com',
'orcaMulticall.vendor.alu.expires': '600',
'orcaMulticall.vendor.alu.crlfKeepAliveInterval': '0',
'orcaMulticall.vendor.alu.sendAuthOnInitReg': 'false',
'orcaMulticall.vendor.alu.sendAuthOnReregDereg': 'true',
'orcaMulticall.vendor.alu.reUseCallidInReregDereg': 'true',
'orcaMulticall.vendor.alu.mediaOptions.addCodecs': 'true', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.persistentPC': 'true', 
'orcaMulticall.vendor.alu.mediaOptions.refreshTiled': 'false',
'orcaMulticall.vendor.alu.mediaOptions.dtmf': 'inband',
'orcaMulticall.vendor.alu.mediaOptions.dtmfDuration': '100',
'orcaMulticall.vendor.alu.mediaOptions.dtmfGap': '70',
'orcaMulticall.vendor.alu.mediaOptions.dtmfWorkaround': 'true',
'orcaMulticall.vendor.alu.mediaOptions.audioBandwidth': '',
'orcaMulticall.vendor.alu.mediaOptions.videoBandwidth': '',
'orcaMulticall.vendor.alu.mediaOptions.dataBandwidth': '',
'orcaMulticall.vendor.alu.mediaOptions.audioCodecs': '',
'orcaMulticall.vendor.alu.mediaOptions.videoCodecs': '',
'orcaMulticall.vendor.alu.mediaOptions.breaker': 'false', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.stripExtraSSRC': 'true', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.useFirstCandidate': 'false',
'orcaMulticall.vendor.alu.mediaOptions.removeIPV6Candidates': 'true', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.msidHandling': '1',
'orcaMulticall.vendor.alu.mediaOptions.enableIMDNCapability': 'true', //boolean as string
'orcaMulticall.vendor.alu.mediaOptions.autoUpgrade': 'true',
'orcaMulticall.vendor.alu.confWorkaroundChrome': 'false', //boolean as string
'orcaMulticall.vendor.alu.servContOptions.autoRegisterOnStartup': 'false', // boolean as a string
'orcaMulticall.vendor.alu.servContOptions.autoAnswerTime': '0', // in sec units (as a string)
'orcaMulticall.vendor.alu.servContOptions.maxRecoveryAttempts': '0',
'orcaMulticall.vendor.alu.servContOptions.networkRetryInterval': '0',
'orcaMulticall.vendor.alu.servContOptions.sendRegisterOnRecovery': 'false', 
'orcaMulticall.vendor.alu.servContOptions.registerResponseTime': '0', 
'orcaMulticall.vendor.alu.servContOptions.registerRefreshTime': '0', 
'orcaMulticall.vendor.alu.mdsp.enableMDSPsupport': 'false',
'orcaMulticall.vendor.alu.mdsp.secondaryDeviceId': 'mobility="fixed"',

// Address Book Config
'orcaMulticall.vendor.alu.abConfig.contactServer': '',
'orcaMulticall.vendor.alu.abConfig.baseAPIResPath': '',

// User parameters (optional default user)
'orcaMulticall.user.login': '+442079590000',	//example: '5552223333'
'orcaMulticall.user.password': null,	//example: 'password'
'orcaMulticall.user.to': '+442079590001'	//example: '5552223333'

};
