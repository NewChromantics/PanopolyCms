const os = require( 'os' );
const fs = require( 'fs' );
const WebSocketModule = require('ws');
const Pop = require('./Pop_PromiseQueue');

const Port = process.env.Port || 8888;	//	gr: needs to be int?
const ArtifactFileTries = process.env.ArtifactFileTries || 10;
const ArtifactPath = process.env.ArtifactPath || './Artifacts';




const WebSocketServer = new WebSocketModule.Server({ port: Port });

WebSocketServer.on('connection',StartWebsocketClientThread);



function GetNewArtifactName()
{
	//	random X chars in alphabet
	const Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	return "ABCD";
}

async function OpenNewArtifactStream()
{
	//	how many tries do we allow?
	//	how do we do this better... we're also relying on the file system to be atomic
	for ( let i=0;	i<ArtifactFileTries;	i++ )
	{
		const Name = GetNewArtifactName();
		try
		{
			const Filename = `${ArtifactPath}/${Name}.popcap`;
			const Options = {};
			Options.flags = 'wx';	//	x = fail if exists
			const Stream = fs.createWriteStream(Filename,Options);
			const Result = {};
			Result.Name = Name;
			Result.Stream = Stream;
			return Stream;
		}
		catch(e)
		{
			console.log(`Failed to open stream for artifact name ${Name}; ${e}`);
		}
	}
	
	throw `Failed to open new artifact name after ${ArtifactFileTries} tries`;
}






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
	let RecvMessageQueue = new Pop.PromiseQueue('RecvMessageQueue');
	function OnMessage(Message)
	{
		RecvMessageQueue.Push(Message);
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
	async function SendAndWaitForReply(Message)
	{
		if ( typeof Message == 'object' )
			Message = JSON.stringify(Message);
		Client.send(Message);
		const Reply = await RecvMessageQueue.WaitForNext();
		//	check reply has a specific reply info
		return Reply;
	}
	Client.on('message',OnMessage);
	Client.on('close',OnClosed);


	//	send "disclaimer"
	//	wait for an auth message
	//	open file with random handle
	const Artifact = OpenNewArtifactStream();
	//	send back Artifact Name
	{
		const ArtifactMessage = {};
		ArtifactMessage.ArtifactName = Artifact.Name;
		const ArtifactAck = await SendAndWaitForReply(ArtifactMessage);
		//	if ArtifactAck != something error
	}
	
	async function RecvLoop()
	{
		while(Connected)
		{
			const Message = await RecvMessageQueue.WaitForNext();
			Artifact.Stream.Write(Message);
		}
	}
	
	//	now absorb messages and write to file
	//	(maybe needs to be another thread so we can send stuff
	const ReadFinishedPromise = await RecvLoop();
	//	occasionly send back meta
	//	check for size limits & stop
}
