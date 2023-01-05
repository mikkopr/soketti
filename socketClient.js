const net = require('net');
const readline = require('readline');

const COMMAND_CHAR = ':';
const MESSAGE_SEPARATOR = '\n';

const appStates = {
	initialize: 'INITIALIZE',
	chat: 'CHAT',
	paused: 'PAUSED',
	exiting: 'EXITING'
};
let appState = appStates.initialize;
let prevAppState = appState;

let username = null;

let exitTimeout = null;
let lineReader = null;
const client = new net.Socket();

client.on('error', (error) => {
	console.log('Sovelluskessa tapahtui virhe: ', error.message);
	//close is called immediately
})

client.on('data', async (data) => 
{
	let i = 0;
	while (i < data.length) {
		let separatorIndex = data.indexOf(MESSAGE_SEPARATOR, i);
		//TODO should save and continue when more data arrives
		if (separatorIndex == -1) {
			console.log('Vaillinainen viesti palvelimelta!');
			return;
		}
		let message = data.subarray(i, separatorIndex);
		processMessage(message);
		i = separatorIndex + 1;
	}
	
	if (appState == appStates.initialize) {
		console.log('Syötä käyttäjänimi');
	}
	if (appState !== appStates.paused) {
		lineReader.prompt(true);
	}
});

client.on('drain', () => {
	//lineReader?.resume();
	if (appState === appStates.paused) {
		changeAppState(prevAppState);
	}
});

client.on('close', (hadError) => 
{
	if (appState === appStates.exiting) {
		clearTimeout(exitTimeout);
	}

	if (hadError) {
		console.log('\nSovellus suljetaan virheen takia.');
	}
	else {
		console.log('\nSovellus suljetaan.');
	}
	lineReader?.close();
});

client.connect(1337, '127.0.0.1', () => {
	console.log('Connected');
	lineReader = createLineReader(client);
});

function processMessage(data)
{
	let dataObject = null;
	try {
		dataObject = JSON.parse(data);
	}
	catch (err) {
		console.log('Sovelluksessa virhe! Vastaanotettu tieto virheellistä.');
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
			console.log('Virheellinen viesti palvelimelta.');
	}
}

function writeToSocket(socket, data)
{
	try {
		//Pause app (reading from input) if the write buffer is getting full (highWaterMark).
		//Reading is resumed, when the socket emits drain event
		if (!socket.write(data + MESSAGE_SEPARATOR)) {
			changeAppState(appStates.paused);
			console.log('Odota hetki...');
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
	try {
		client.end();
		exitTimeout = setTimeout(() => {
			client.destroy();
		}, 3000);
	}
	catch (err) {
		try {
			console.log('client.destroy()');
			client.destroy();
		}
		catch(err) {
		}
	}
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

function handleMessage(dataObject, private)
{
	if (appState === appStates.chat) {
		const privateMark = private ? '(private)' : '';
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
