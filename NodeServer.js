const os = require( 'os' );
const fs = require( 'fs' );
const WebSocketModule = require('ws');
const Pop = require('./PopApi');

const Port = process.env.Port || 8888;	//	gr: needs to be int?
const ArtifactFileTries = process.env.ArtifactFileTries || 10;
const ArtifactPath = process.env.ArtifactPath || './Artifacts';


const WebSocketServer = new WebSocketModule.Server({ port: Port });
console.log(`Started websocket server on ${JSON.stringify(WebSocketServer.address())}`);
WebSocketServer.on('connection',StartWebsocketClientThread);



function GetNewArtifactName()
{
	//	random X chars in alphabet
	const Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	return "ABCD";
}


class TArtifact
{
	constructor(Name)
	{
		this.Name = Name;
		this.Filename = `${ArtifactPath}/${this.Name}.PopCap`;
		this.Error = null;
		this.Stream = null;
		
		const Options = {};
		Options.flags = 'wx';	//	x = fail if exists
		this.Stream = fs.createWriteStream(this.Filename,Options);
		this.Stream.on('error', this.OnError.bind(this) );
	}
	
	OnError(Error)
	{
		console.log(`Artifact stream error ${Error}`);
		this.Error = Error || 'Unspecified stream error';
	}
	
	Write(Data)
	{
		//	file has errored!
		if ( this.Error !== null )
		{
			console.log(`Error failed as file has failed ${this.Error}`);
			throw this.Error;
		}
		this.Stream.write(Data);
		//console.log(`Wrote x${Data.length}`);
	}
}

async function OpenNewArtifactStream()
{
	let Error = null;
	
	function OnError(Error)
	{
		//	https://stackoverflow.com/questions/20864036/error-handling-on-createwritestream
		//file.read();
		console.log(`Open file error ${Error}`);
	}
	
	
	//	how many tries do we allow?
	//	how do we do this better... we're also relying on the file system to be atomic
	for ( let i=0;	i<ArtifactFileTries;	i++ )
	{
		const Name = GetNewArtifactName();
		try
		{
			const Artifact = new TArtifact(Name);
			return Artifact;
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
	console.log(`StartWebsocketClientThread(${Client},${Request})`);
	const ClientAddress = Request.socket.remoteAddress;

	function Disconnect(Error)
	{
		console.log(`Disconnect(${Error})`);
		//	if error, send hail mary message before disconnecting
		if ( Error )
		{
			console.log(`Disconnect, sending hail mary error message ${Error}`);
			const Message = {};
			Message.Error = Error;
			Client.send(JSON.stringify(Message));
		}
		Client.terminate();
	}
	Client.on('error',Disconnect);
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
	const Artifact = await OpenNewArtifactStream();
	{
		const StreamInitMessage = {};
		StreamInitMessage.CmsInit = true;
		Artifact.Write(JSON.stringify(StreamInitMessage));
	}
	//	send back Artifact Name
	{
		const ArtifactMessage = {};
		ArtifactMessage.Command = 'Hello';
		ArtifactMessage.ArtifactName = Artifact.Name;
		const ArtifactAck = await SendAndWaitForReply(ArtifactMessage);
		//	if ArtifactAck != something error
	}
	
	async function RecvLoop()
	{
		//	write everything we recieve into the file
		while(Connected)
		{
			const Message = await RecvMessageQueue.WaitForNext();
			Artifact.Write(Message);
		}
	}
	
	function GetPingMessage()
	{
		const Message = {};
		Message.Command = 'Ping';
		return Message;
	}
	
	async function PingLoop()
	{	
		//	occasionally send status back, this also will let us know if socket disconnects
		while(Connected)
		{
			await Pop.Yield(10*1000);
			const Message = GetPingMessage();
			Client.send( JSON.stringify(Message) );
		}
	}
	
	//	now absorb messages and write to file
	const ReadLoopFinished = RecvLoop();
	//	todo: check for size limits & stop (in ping loop?)
	const PingLoopFinished = PingLoop();
	
	//	wait for a thread to exit (probbaly disconnected)
	await Promise.race([ReadLoopFinished,PingLoopFinished]);
	
	return 'WebsocketClientThread finished';
}

