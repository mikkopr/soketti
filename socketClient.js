const net = require('net');
const readline = require('readline');

const COMMAND_CHAR = ':';

const appStates = {initialize: 'INITIALIZE', chat: 'CHAT'};
let appState = appStates.initialize;
let username = null;

let lineReader = null;
const client = new net.Socket();

client.on('error', (error) => {
	console.log('Sovelluskessa tapahtui virhe: ', error.message);
	//close is called immediately
})

client.on('data', async (data) => 
{
	//TODO: Saapuvassa datassa pitäisi olla header, jossa datan pituus

	//It's assumed that arrived data contains the whole json object
	let dataObject = null;
	try {
		dataObject = JSON.parse(data);
	}
	catch (err) {
		console.log('Sovelluksessa virhe! Vastaanotettu tieto virheellistä.');
		lineReader.prompt();
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
			console.log(dataObject.data);
			break;
		default:
			console.log('Virheellinen viesti palvelimelta.');
	}
	if (appState == appStates.initialize) {
		console.log('Syötä käyttäjänimi');
	}
	lineReader.prompt();
});

client.on('close', (hadError) => 
{
	if (hadError) {
		console.log('Sovellus suljetaan virheen takia.');
	}
	else {
		console.log('Sovellus suljetaan.');
	}
	lineReader?.close();
});

client.connect(1337, '127.0.0.1', () => {
	console.log('Connected');
	lineReader = createLineReader(client);
});

function createLineReader(socket)
{
	console.log('Komento :EXIT sulkee ohjelman ja :HELP tulostaa ohjeen.');
	let rl = readline.createInterface(process.stdin, process.stdout);
	rl.setPrompt(`>`);
	rl.prompt()
	
	rl.on('line', (input) => {
			processInput(input, socket);
			lineReader?.prompt();
		});

	return rl;
}

function processInput(input, socket)
{
	//When initializing the input is assumed to be username, no command needed
	if (appState == appStates.initialize) {
		const dataObject = {type: 'CHANGE_USERNAME', data: input};
		socket.write(JSON.stringify(dataObject));
	}
	else {
		const command = parseCommandFromInput(input);
		//console.log('command=' + command);
		if (command === 'EXIT') {
			if (socket) {
				socket.end();
			}
			else {
				lineReader?.close();
			}
			return;
		}
		const dataObject = createMessageFromInput(input, command);
		if (!dataObject) {
			console.log('Virheellinen komento!');
		}
		else {
			socket.write(JSON.stringify(dataObject));
		}
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
	appState = appStates.chat;
	username = dataObject.data;
	console.log('Käyttäjänimesi on ' + username);
}

function handleUsernameRejected(dataObject)
{
	username = null;
	console.log(dataObject.data);
}
