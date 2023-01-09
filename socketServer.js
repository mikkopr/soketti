
import { WebSocketServer } from 'ws';

const usage = `
Komennot:
:EXIT     Sulkee ohjelman
:HELP     Tulostaa ohjeen
:PRIVATE nimi viesti     Lähettää yksityisviestin
:ADMIN    Pyytää admin oikeudet (vanhin käyttäjä)
:KICK nimi     Poistaa käyttäjän    
`

let users = []; //{socket:, name:, isAdmin:}

const wsServer = new WebSocketServer({port:8080});

wsServer.on('connection', (socket) =>
{
	writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Tervetuloa chattiin!'}));
	users.push({socket: socket, name: null, isAdmin: false});

	socket.on('message', (data) => 
	{	
		processMessage(socket, data);
	});
	
	socket.on('error', (error) => {
		console.log(`Error! code: ${error.code} message: ${error.message}`);
	});

	socket.on('close', (code, reason) => {
		console.log(`Client connection closed. code: ${code} reason: ${reason}`);
		let index = users.findIndex(item => item.socket === socket);
		if (index >= 0) {
			users = users.slice(0, index).concat(users.slice(index + 1, -1));
		}
	});
});

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
	const receiver = users.find(item => item.name === receivedData.receiver);
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
	if (users.find(item => item.name === receivedData.data)) {
		writeToSocket(socket, JSON.stringify({type: 'USERNAME_REJECTED', data: 'Käyttäjänimi on jo käytössä.'}));
		return;
	}
	const user = users.find(item => item.socket === socket);
	user.name = receivedData.data;
	writeToSocket(socket, JSON.stringify({type: 'USERNAME_CHANGED', data: user.name}));
}

function handleRequestAdminRights(socket, dataObject, users)
{
	//The oldest user is allowed to be admin
	let index = users.findIndex(item => item.socket === socket);
	if (index === 0) {
		users[index].isAdmin = true;
		writeToSocket(socket, JSON.stringify({type: 'INFO', data: 'Olet admin'}));
	}
	else {
		writeToSocket(socket,JSON.stringify({type: 'INFO', data: 'Admin pyyntö hylätty.'}));
	}
}

function handleKickUser(socket, dataObject, users)
{
	const kicker = users.find(item => item.socket === socket);
	if (kicker.isAdmin) {
		const targetIndex = users.findIndex(item => item.name === dataObject.data);
		if (targetIndex >= 0) {
			const target = users[targetIndex];
			writeToSocket(target.socket, JSON.stringify({type: 'INFO', data: `Sinut on poistettu chatista.`}));
			//Close the socket on the next round of the event loop, otherwise the previous message isn't sended
			setTimeout(() => {
				target.socket?.close(1000);
				users = users.slice(0, targetIndex).concat(users.slice(targetIndex + 1, -1));
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
