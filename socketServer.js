
const net = require('net');

const usage = `
Komennot:
:EXIT     Exits
:HELP     Prints help
:PRIVATE receiver message     Sends the private message to the receiver
`

let users = []; //{socket:, name:, isAdmin:}

let server = net.createServer((socket) => {
	socket.write(JSON.stringify({type: 'INFO', data: 'Tervetuloa chattiin!'}));
	users.push({socket: socket, name: null, isAdmin: false});
	
	socket.on('data', (data) => 
	{	
		//TODO: Saapuvassa datassa pitäisi olla header, jossa datan pituus

		//It's assumed that arrived data contains the whole json object
		let dataObject = null;
		try {
			dataObject = JSON.parse(data);
		}
		catch (err) {
			console.log('Unable to parse incoming JSON!');
			socket.write('Sovelluksessa virhe!');
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
				socket.write(JSON.stringify({type: 'INFO', data: usage}));
				break;
			default:
				console.log('Error: Unknown command:' + dataObject.command);
				socket.write('Error!');
		}
	});
	
	socket.on('error', (error) => {
		console.log('Error:', error.message);
	});

	socket.on('close', (hadError) => {
		console.log('Client connection closed hadError=' + hadError);
		let index = users.findIndex(item => item.socket === socket);
		if (index >= 0) {
			users = users.slice(0, index).concat(users.slice(index + 1, -1));
		}
	});
});

server.listen(1337, '127.0.0.1');

function handleMessage(socket, receivedData, users)
{
	const dataObject = {type: 'MESSAGE', data: receivedData.data, sender: receivedData.sender};
	//Send message everybody but the sender
	users.forEach((user) => {
		if (user.socket !== socket)
			user.socket.write(JSON.stringify(dataObject));
	});
}

function handlePrivateMessage(socket, receivedData, users)
{
	const receiver = users.find(item => item.name === receivedData.receiver);
	if (!receiver) {
		const dataObject = {type: 'INFO', data: 'Vastaanottajaa ei löydy!'};
		socket.write(JSON.stringify(dataObject));
	}
	else {
		const dataObject = {type: 'PRIVATE_MESSAGE', data: receivedData.data, sender: receivedData.sender};
		receiver.socket.write(JSON.stringify(dataObject));
	}
}

function handleChangeUsername(socket, receivedData, users)
{
	if (receivedData.data.length === 0) {
		socket.write(JSON.stringify({type: 'USERNAME_REJECTED', data: 'Käyttäjänimi virheellinen.'}));
		return;
	}
	if (users.find(item => item.name === receivedData.data)) {
		socket.write(JSON.stringify({type: 'USERNAME_REJECTED', data: 'Käyttäjänimi on jo käytössä.'}));
		return;
	}
	const user = users.find(item => item.socket === socket);
	user.name = receivedData.data;
	socket.write(JSON.stringify({type: 'USERNAME_CHANGED', data: user.name}));
}

function handleRequestAdminRights(socket, dataObject, users)
{
	//The oldest user is allowed to be admin
	let index = users.findIndex(item => item.socket === socket);
	if (index === 0) {
		users[index].isAdmin = true;
		socket.write(JSON.stringify({type: 'INFO', data: 'Olet admin'}));
	}
	else {
		socket.write(JSON.stringify({type: 'INFO', data: 'Admin pyyntö hylätty.'}));
	}
}

function handleKickUser(socket, dataObject, users)
{
	const kicker = users.find(item => item.socket === socket);
	if (kicker.isAdmin) {
		const targetIndex = users.findIndex(item => item.name === dataObject.data);
		if (targetIndex >= 0) {
			const target = users[targetIndex];
			target.socket.end(JSON.stringify({type: 'INFO', data: `Sinut on positettu chatista.`}));
			users = users.slice(0, targetIndex).concat(users.slice(targetIndex + 1, -1));
			socket.write(JSON.stringify({type: 'INFO', data: `Käyttäjä ${dataObject.data} poistettu.`}));
		}
		else {
			socket.write(JSON.stringify({type: 'INFO', data: `Käyttäjää ${dataObject.data} ei löydy`}));
		}
	}
	else {
		socket.write(JSON.stringify({type: 'INFO', data: 'Ei valtuuksia.'}));
	}
}
