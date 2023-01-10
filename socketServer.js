
import { WebSocketServer } from 'ws';
import * as https from 'https';
import * as fs from 'fs';

const PORT = 8080;
const CERT = './cert.pem';
const KEY = './key.pem';

//How often ping messages sent
const PING_INTERVAL_MS = 10000;

const usage = `
Komennot:
:EXIT     Sulkee ohjelman
:HELP     Tulostaa ohjeen
:PRIVATE nimi viesti     Lähettää yksityisviestin
:ADMIN    Pyytää admin oikeudet (vanhin käyttäjä)
:KICK nimi     Poistaa käyttäjän    
`

const users = new Map(); //{socket:, name:, isAdmin:}

const httpServer = https.createServer({
	cert: fs.readFileSync(CERT),
	key: fs.readFileSync(KEY)
});

const wsServer = new WebSocketServer({server: httpServer});

const pingIntervalId = setInterval(() => {
	users.forEach( (value, key) => {
		//If pong response hasn't arrived, terminate
		if (value.socket.isAlive === false) {
			value.socket.terminate();
			return;
		}
		value.socket.isAlive = false;
		value.socket.ping();
	})
}, PING_INTERVAL_MS);

wsServer.on('connection', (socket) =>
{
	socket.isAlive = true;
	writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Tervetuloa chattiin!'}));
	users.set(socket, {socket: socket, name: null, isAdmin: false});

	socket.on('message', (data) => 
	{	
		processMessage(socket, data);
	});
	
	socket.on('pong', () => {
		socket.isAlive = true;
	});

	socket.on('error', (error) => {
		console.log(`Error! code: ${error.code} message: ${error.message}`);
		removeUser(socket);
	});

	socket.on('close', (code, reason) => {
		console.log(`Client connection closed. code: ${code} reason: ${reason}`);
		clearInterval(pingIntervalId);
		removeUser(socket);
	});
});

httpServer.listen(PORT);


function processMessage(socket, data)
{
	let dataObject = null;
	try {
		dataObject = JSON.parse(data);
	}
	catch (err) {
		console.log('Unable to parse incoming JSON!');
		console.log(data.toString('utf8'));
		writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Sovelluksessa virhe!'}));
		return;
	}
	switch (dataObject.type) {
		case 'MESSAGE':
			handleMessage(socket, dataObject, users);
			break;
		case 'PRIVATE_MESSAGE':
			handlePrivateMessage(socket, dataObject, users);
			break;
		case 'CHANGE_USERNAME':
			handleChangeUsername(socket, dataObject, users);
			break;
		case 'REQUEST_ADMIN_RIGHTS':
			handleRequestAdminRights(socket, dataObject, users);
			break;
		case 'KICK_USER':
			handleKickUser(socket, dataObject, users);
			break;
		case 'HELP':
			writeToSocket(socket, JSON.stringify({type: 'INFO', data: usage}));
			break;
		default:
			console.log('Error: Unknown message type:' + dataObject.type);
			writeToSocket(socket, JSON.stringify({type: 'INFO', data:'Lähetetyn viestin tyyppi tuntematon'}));
	}
}

function writeToSocket(socket, data)
{
	try {
		socket.send(data);
	}
	catch (err) {
		console.log('Error: Failed to write to socket. Message: ' + err.message);
	}
}

function findUserByName(name)
{
	for (const user of users.values()) {
		if (user.name === name) {
			return user;
		}
	}
	return null;
}

function removeUser(socket)
{
	users.delete(socket);
}

function handleMessage(socket, receivedData, users)
{
	const dataObject = {type: 'MESSAGE', data: receivedData.data, sender: receivedData.sender};
	//Send message everybody but the sender
	users.forEach((user) => {
		if (user.socket !== socket)
			writeToSocket(user.socket, JSON.stringify(dataObject));
	});
}

function handlePrivateMessage(socket, receivedData, users)
{
	let receiver = findUserByName(receivedData.name);
	
	if (!receiver) {
		const dataObject = {type: 'INFO', data: 'Vastaanottajaa ei löydy!'};
		writeToSocket(socket, JSON.stringify(dataObject));
	}
	else {
		const dataObject = {type: 'PRIVATE_MESSAGE', data: receivedData.data, sender: receivedData.sender};
		writeToSocket(receiver.socket, JSON.stringify(dataObject));
	}
}

function handleChangeUsername(socket, receivedData, users)
{
	if (receivedData.data.length === 0) {
		writeToSocket(socket, JSON.stringify({type: 'USERNAME_REJECTED', data: 'Käyttäjänimi virheellinen.'}));
		return;
	}
	if (findUserByName(receivedData.data)) {
		writeToSocket(socket, JSON.stringify({type: 'USERNAME_REJECTED', data: 'Käyttäjänimi on jo käytössä.'}));
		return;
	}
	const user = users.get(socket);
	user.name = receivedData.data;
	writeToSocket(socket, JSON.stringify({type: 'USERNAME_CHANGED', data: user.name}));
}

function handleRequestAdminRights(socket, dataObject, users)
{
	//Only one admin allowed, the first admin request accepted
	let adminExists = false;
	for (const user of users.values()) {
		if (user.isAdmin) {
			adminExists = true;
			break;
		}
	}
	if (adminExists) {
		writeToSocket(socket,JSON.stringify({type: 'INFO', data: 'Admin pyyntö hylätty. Admin on jo valittu.'}));
	}
	else {
		users.get(socket).isAdmin = true;
		writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Olet admin'}));
	}
}

function handleKickUser(socket, dataObject, users)
{
	const kicker = users.get(socket);
	if (kicker.isAdmin) {
		const target = findUserByName(dataObject.data);
		if (target) {
			writeToSocket(target.socket, JSON.stringify({type: 'INFO', data: `Sinut on poistettu chatista.`}));
			//Close the socket on the next round of the event loop, otherwise the previous message isn't sended
			setTimeout(() => {
				target.socket?.close(1000);
				users.delete(target.socket);
				writeToSocket(socket, JSON.stringify({type: 'INFO', data: `Käyttäjä ${target.name} poistettu.`}));
			}, 0);
		}
		else {
			writeToSocket(socket, JSON.stringify({type: 'INFO', data: `Käyttäjää ${dataObject.data} ei löydy`}));
		}
	}
	else {
		writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Ei valtuuksia.'}));
	}
}
