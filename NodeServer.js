const os = require( 'os' );
const fs = require( 'fs' );
const WebSocketModule = require('ws');
const Pop = require('./PopApi');
const ExpressModule = require('express');


const CorsOrigin = process.env.CorsOrigin || '*';
const ErrorStatusCode = process.env.ErrorStatusCode || 500;
const StaticFilesPath = process.env.StaticFilesPath || './';
const PullPort = process.env.PullPort || 80;
const PushPort = process.env.PushPort || 80;
const ArtifactFileTries = process.env.ArtifactFileTries || 20;
const ArtifactPath = process.env.ArtifactPath || './Artifacts';
try
{
	const AllEnv = JSON.stringify(process.env,null,'\t');
	console.log(`env (all) ${AllEnv}`);
}
catch(e)
{
	console.log(`env (all) error -> ${e}`);
}


const RecordStreamPacketDelin = 'Pop\n';	//	gr: i insert this before every packet when writing files, so we need it here too.
const ArtifactUrlPattern = new RegExp('\/([A-Za-z]){4}$')
const ArtifactAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";


//	gr: for sloppy, we can only expose one port (I think), so we share the http server
const SharingHttpServer = ( PullPort == PushPort );

//	artifact server
const HttpServerApp = ExpressModule();
HttpServerApp.get(ArtifactUrlPattern,HandleGetArtifact);
HttpServerApp.get('/', function (req, res) { res.redirect('/index.html') });
HttpServerApp.use('/', ExpressModule.static(StaticFilesPath));
const HttpServer = HttpServerApp.listen( PullPort, () => console.log( `Pull http server on ${JSON.stringify(HttpServer.address())}` ) );

//	artifact recorder
const WebSocketOptions = SharingHttpServer ? { noServer:SharingHttpServer } : { port: PushPort };
const WebSocketServer = new WebSocketModule.Server(WebSocketOptions);
WebSocketServer.on('connection',StartWebsocketClientThread);

if ( SharingHttpServer )
{
	HttpServer.on('upgrade', (request, socket, head) => 
	{
		WebSocketServer.handleUpgrade(request, socket, head, socket => 
		{
			WebSocketServer.emit('connection', socket, request);
		}
		);
	});
	
	//	get an exception if we use this address() in no-server mode
	WebSocketServer.address = HttpServer.address;
}

console.log(`Push websocket server on ${JSON.stringify(WebSocketServer.address())}`);



function GetNewArtifactName()
{
	//	random X chars in alphabet
	const a = Pop.RandomInt(0,ArtifactAlphabet.length);
	const b = Pop.RandomInt(0,ArtifactAlphabet.length);
	const c = Pop.RandomInt(0,ArtifactAlphabet.length);
	const d = Pop.RandomInt(0,ArtifactAlphabet.length);
	const abcd = [a,b,c,d].map( i => ArtifactAlphabet[i] );
	return abcd.join('');
}

function GetArtifactFilename(ArtifactName)
{
	return `${ArtifactPath}/${ArtifactName}.PopCap`;		
}


class TArtifact
{
	constructor(Name)
	{
		this.Name = Name;
		this.Filename = GetArtifactFilename(this.Name);
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
	
	WritePacket(Data)
	{
		//	file has errored!
		if ( this.Error !== null )
		{
			console.log(`Error failed as file has failed ${this.Error}`);
			throw this.Error;
		}
		this.Stream.write(RecordStreamPacketDelin);
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
		//	add meta here
		const StreamInitMessage = {};
		StreamInitMessage.CmsInit = true;
		Artifact.WritePacket(JSON.stringify(StreamInitMessage));
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
			Artifact.WritePacket(Message);
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


async function GetArtifactPipe(Request)
{
	const ArtifactName = Request.path.slice(1).toUpperCase();	//	strip / and we allow lower case letters, but artifacts are uppercase
	console.log(`Requst artifact ${ArtifactName}`);
	const ArtifactFilename = GetArtifactFilename(ArtifactName);
	//	gr: this doesn't 404 here...
	const Stream = fs.createReadStream(ArtifactFilename);
	return Stream;
}


async function HandleGetArtifact(Request,Response)
{
	try
	{
		const ArtifactStream = await GetArtifactPipe(Request);
		
		const Output = {};
		Output.Mime = 'application/octet-stream';
		
		const StreamFinished = Pop.CreatePromise();
		
		ArtifactStream.on('end', StreamFinished.Resolve );
		ArtifactStream.on('error', StreamFinished.Reject );
		
		//	PopImageServer generic code
		//const Output = await RunApp(Request);
		Output.StatusCode = Output.StatusCode || 200;
		Output.Mime = Output.Mime || 'text/plain';

		Response.statusCode = Output.StatusCode;
		Response.setHeader('Content-Type',Output.Mime);
		Response.setHeader('Access-Control-Allow-Origin',CorsOrigin);	//	allow CORS
		ArtifactStream.pipe(Response);
		
		//	should this wait until end event?
		//	we kinda need a way to stop if there was an error and not pipe until then?
		console.log(`Wait for stream finished`);
		await StreamFinished;
		Response.end();
		//Response.end(Output.Output);
	}
	catch (e)
	{
		console.log(`RunApp error -> ${e}`);
		Response.statusCode = ErrorStatusCode;
		Response.setHeader('Content-Type','text/plain');
		Response.end(`Error ${e}`);
	}
}


