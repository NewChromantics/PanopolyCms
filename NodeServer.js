const os = require( 'os' );
const fs = require( 'fs' );
const WebSocketModule = require('ws');

const Port = process.env.Port || 80;	//	gr: needs to be int?
const RandomFileTries = process.env.RandomFileTries || 10;
const ArtifactPath = process.env.ArtifactPath || './Artifacts';
const WebSocketServer = new WebSocketModule.Server({ port: Port });

wss.on('connection',StartWebsocketClientThread);



function GetUniqueArtifactName()
{
	//	random X chars in alphabet
	const Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	return "ABCD";
}

async function OpenNewArtifactStream()
{
	//	how many tries do we allow?
	//	how do we do this better... we're also relying on the file system to be atomic
	for ( let i=0;	i<RandomFileTries;	i++ )
	{
		try
		{
			const Name = GetUniqueName();
			const Filename = `${ArtifactPath}/${Name}.popcap`;
			const Stream = fs.createWriteStream(Filename, open exclusive new );
		}
		catch(e)
		{
			console.log(`Failed to open unique na






function StartWebsocketClientThread(Client,Request)
{
	const ClientAddress = Request.socket.remoteAddress;

	function Disconnect(Error)
	{
		//	if error, send hail mary message before disconnecting
		if ( Error )
		{
			const Message = {};
			Message.Error = Error;
			Client.send(JSON.stringify(Message));
		}
		Client.terminate();
	}
	WebsocketClientThread(Client).then(Disconnect).catch(Disconnect);
}

async function WebsocketClientThread(Client)
{
	let Connected = true;
	let RecvMessageQueue = [];
	function OnMessage(Message)
	{
		RecvMessageQueue.push(Message);
	}
	function OnClosed()
	{
		Connected = false;
	}
	async function WaitForMessage()
	{
		if ( !Connected )
			throw `Disconnected`;
		throw `todo WaitForMessage`;
	}
	Client.on('message',OnMessage);
	Client.on('close',OnClosed);

	//	async function SendAndWaitForReply(Message)	{	 Client.send(Message);	}

	//	send "disclaimer"
	//	wait for an auth message
	//	open file with random handle
	//	send back handle
	//	now absorb messages and write to file
	//	occasionly send back meta
	//	check for size limits & stop
}
