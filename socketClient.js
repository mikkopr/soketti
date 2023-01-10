
import WebSocket from 'ws';
import readline from 'readline';

//process.env.NODE_EXTRA_CA_CERTS = './cert.pem';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0; //Self signed certificate

const SERVER = 'wss://127.0.0.1:8080';
const COMMAND_CHAR = ':';
//Interval in milliseconds socket's write buffer is polled for draining
const DRAIN_POLL_INTERWAL_MS = 100;
const HANDSHAKE_TIMEOUT_MS = 5000;

const appStates = {
	initialize: 'INITIALIZE',
	chat: 'CHAT',
	paused: 'PAUSED',
	exiting: 'EXITING'
};
let appState = appStates.initialize;
let prevAppState = appState;

let username = null;

let drainPollInterwallId = null;
let lineReader = null;

const webSocket = new WebSocket(SERVER, {handshakeTimeout: HANDSHAKE_TIMEOUT_MS, timeout: 5000});

webSocket.on('error', (error) => {
	console.log(`Sovelluskessa tapahtui virhe! koodi: ${error.code}  message: ${error.message}`);
	lineReader?.close();
})

webSocket.on('message', async (data) => 
{
	processMessage(data);
	
	if (appState == appStates.initialize) {
		console.log('Syötä käyttäjänimi');
	}
	if (appState !== appStates.paused) {
		lineReader.prompt(true);
	}
});

webSocket.on('close', (code, reason) => 
{
	if (code === 1000) {
		console.log('\nSovellus suljetaan.');
	}
	else {
		console.log(`\nSovellus suljetaan yhteysvirheen takia. koodi: ${code} syy: ${reason}`);
	}
	lineReader?.close();
});

webSocket.on('open', () => 
{
	console.log('Connected');
	lineReader = createLineReader(webSocket);
});

/*webSocket.on('ping', () => {
	console.log('ping');
});*/

function processMessage(data)
{
	let dataObject = null;
	try {
		dataObject = JSON.parse(data);
	}
	catch (err) {
		console.log('Sovelluksessa virhe! Vastaanotettu tieto virheellistä.');
		console.log('data: ' + data);
		if (appState !== appStates.paused) {
			lineReader.prompt(true);
		}
		return;	
	}

	switch (dataObject.type) {
		case 'MESSAGE':
			handleMessage(dataObject);
			break;
		case 'PRIVATE_MESSAGE':
			handleMessage(dataObject, true);
			break;
		case 'USERNAME_CHANGED':
			handleUsernameChanged(dataObject);
			break;
		case 'USERNAME_REJECTED':
			handleUsernameRejected(dataObject);
			break;
		case 'INFO':
			console.log('\n' + dataObject.data);
			break;
		default:
			console.log('Virheellinen viesti palvelimelta. Viestin tyyppi tuntematon.');
	}
}

function writeToSocket(socket, data)
{
	try {
		//If the socket's write buffer is empty write immediately, otherwise pause and wait
		//until the buffer is empty.
		if (socket.bufferedAmount == 0) {
			socket.send(data);
		}
		else {
			changeAppState(appStates.paused);
			console.log('Odota hetki...');
			drainPollInterwallId = setInterval((data) => {
				if (socket.bufferedAmount == 0) {
					if (drainPollInterwallId) {
						clearInterval(drainPollInterwallId);
						drainPollInterwallId = null;
					}
					//App is paused, resume
					changeAppState(prevAppState);
					socket.send(data);
				}
			}, DRAIN_POLL_INTERWAL_MS);
		}
	}
	catch (err) {
		console.log('Error: Failed to write to socket. Message: ' + err.message);
	}
}

function changeAppState(nextAppState)
{
	prevAppState = appState;
	appState = nextAppState;
}

function exitApp()
{
	changeAppState(appStates.exiting);
	webSocket.close(1000);
}

function createLineReader(socket)
{
	console.log('Komento :EXIT sulkee ohjelman ja :HELP tulostaa ohjeen.');
	let rl = readline.createInterface(process.stdin, process.stdout);
	rl.setPrompt(`>`);
	rl.prompt(true)
	
	rl.on('line', (input) => {
			processInput(input, socket);
			if (appState !== appStates.paused) {
				lineReader?.prompt(true);
			}
		});

	return rl;
}

function processInput(input, socket)
{
	const command = parseCommandFromInput(input);
	
	if (command === 'EXIT') {
		exitApp();
		return;
	}

	//When initializing the input is assumed to be username, no command needed
	if (appState == appStates.initialize) {
		const dataObject = {type: 'CHANGE_USERNAME', data: input};
		writeToSocket(socket, JSON.stringify(dataObject));
		return;
	}

	if (appState === appStates.paused) {
		console.log('Odota hetki...');
		return;
	}

	const dataObject = createMessageFromInput(input, command);
	if (!dataObject) {
		console.log('Virheellinen komento!');
	}
	else {
		writeToSocket(socket, JSON.stringify(dataObject));
		
		//TEST
		//lineReader.pause();
		/*changeAppState(appStates.paused);
		console.log('paused');
		setTimeout(() => {
				console.log('resume');
				//lineReader.resume();
				changeAppState(prevAppState);
				lineReader.prompt(true);
			}, 5000);*/
	}
}

function parseCommandFromInput(input)
{
	if (input.startsWith(COMMAND_CHAR)) {
		let commandEndIndex = input.indexOf(' ');
		commandEndIndex = commandEndIndex > 0 ? commandEndIndex : input.length;
		let command = input.substring(1, commandEndIndex);
		if (!command || command.length === 0) {
			return '';
		}
		return command;
	}
	return '';
}

function createMessageFromInput(input, command)
{
	//Generate message based on possible command at the beginning of input.
	//If no command, the input is a message
	if (command.length > 0) {
		let currentIndex = input.indexOf(' ', command.length) + 1;
		switch (command) {
			case 'PRIVATE':
			{
				let nextSpaceIndex = input.indexOf(' ', currentIndex);
				if (nextSpaceIndex === -1) {
					return null;
				}
				let receiver = input.substring(currentIndex, nextSpaceIndex);
				currentIndex = nextSpaceIndex + 1;
				let message = input.substring(currentIndex);
				if (receiver.length === 0 || message.length === 0) {
					return null; 
				}
				return {type: 'PRIVATE_MESSAGE', data: message, sender: username, receiver: receiver};
			}
			case 'NAME':
				return {type: 'CHANGE_USERNAME', data: input.substring(currentIndex)};
			case 'ADMIN':
				return {type: 'REQUEST_ADMIN_RIGHTS'};
			case 'KICK':
			{
				let target = input.substring(currentIndex);
				console.log('KICK: ' + target);
				if (target.length === 0) {
					return null; 
				}
				return {type: 'KICK_USER', data: target, sender: username};
			}	
			case 'HELP':
				return {type: 'HELP'};
			default:
				return null;
		}
	}
	else {
		return {type: 'MESSAGE', data: input, sender: username};
	}
}

function handleMessage(dataObject, isPrivate)
{
	if (appState === appStates.chat) {
		const privateMark = isPrivate ? '(private)' : '';
		console.log('\n' + dataObject.sender + privateMark + `: ` + dataObject.data);
	}
}

function handleUsernameChanged(dataObject)
{
	if (appState === appStates.initialize) {
		changeAppState(appStates.chat);
	}
	username = dataObject.data;
	lineReader.setPrompt(`${username}>`);
	console.log('\nKäyttäjänimesi on ' + username);
}

function handleUsernameRejected(dataObject)
{
	username = null;
	console.log(dataObject.data);
}
