const os = require( 'os' );
const fs = require( 'fs' );
const WebSocketModule = require('ws');


const Port = process.env.Port || 8888;	//	gr: needs to be int?
const ArtifactFileTries = process.env.ArtifactFileTries || 10;
const ArtifactPath = process.env.ArtifactPath || './Artifacts';


const Pop = {};
//const PopApi = require('PopEngineCommon/PopApi.js');

//	a promise queue that manages multiple listeners
//	gr: this is getting out of sync with the cyclic-fixing-copy in WebApi. Make it seperate!
Pop.PromiseQueue = class
{
	constructor(DebugName='UnnamedPromiseQueue')
	{
		this.Name = DebugName;
		//	pending promises
		this.Promises = [];
		//	values we've yet to resolve (each is array capturing arguments from push()
		this.PendingValues = [];
	}

	async WaitForNext()
	{
		const Promise = this.Allocate();
		
		//	if we have any pending data, flush now, this will return an already-resolved value
		this.FlushPending();
		
		return Promise;
	}

	//	this waits for next resolve, but when it flushes, it returns LAST entry and clears the rest; LIFO (kinda, last in, only out)
	async WaitForLatest()
	{
		const Promise = this.Allocate();

		//	if we have any pending data, flush now, this will return an already-resolved value
		this.FlushPending(true);

		return Promise;
	}
	
	ClearQueue()
	{
		//	delete values, losing data!
		this.PendingValues = [];
	}
	
	//	allocate a promise, maybe deprecate this for the API WaitForNext() that makes more sense for a caller
	Allocate()
	{
		//	create a promise function with the Resolve & Reject functions attached so we can call them
		function CreatePromise()
		{
			let Callbacks = {};
			let PromiseHandler = function (Resolve,Reject)
			{
				Callbacks.Resolve = Resolve;
				Callbacks.Reject = Reject;
			}
			let Prom = new Promise(PromiseHandler);
			Prom.Resolve = Callbacks.Resolve;
			Prom.Reject = Callbacks.Reject;
			return Prom;
		}
		
		const NewPromise = CreatePromise();
		this.Promises.push( NewPromise );
		return NewPromise;
	}
	
	//	put this value in the queue, if its not already there (todo; option to choose oldest or newest position)
	PushUnique(Value)
	{
		const Args = Array.from(arguments);
		function IsMatch(PendingValue)
		{
			//	all arguments are now .PendingValues=[] or .RejectionValues=[]
			//	we are only comparing PendingValues, lets allow rejections to pile up as
			//	PushUnique wont be rejections. The Reject() code should have a RejectUnique() if this becomes the case
			if (!PendingValue.hasOwnProperty('ResolveValues'))
				return false;

			const a = PendingValue.ResolveValues;
			const b = Args;
			if ( a.length != b.length )	return false;
			for ( let i=0;	i<a.length;	i++ )
				if ( a[i] != b[i] )
					return false;
			return true;
		}
		//	skip adding if existing match
		if ( this.PendingValues.some(IsMatch) )
		{
			//Pop.Debug(`Skipping non-unique ${Args}`);
			return;
		}
		this.Push(...Args);
	}
	
	Push()
	{
		const Args = Array.from(arguments);
		const Value = {};
		Value.ResolveValues = Args;
		this.PendingValues.push( Value );
		
		if ( this.PendingValues.length > 100 )
			Pop.Warning(`This (${this.Name}) promise queue has ${this.PendingValues.length} pending values and ${this.Promises.length} pending promises`,this);
		
		this.FlushPending();
	}
	
	GetQueueSize()
	{
		return this.PendingValues.length;
	}
	
	HasPending()
	{
		return this.PendingValues.length > 0;
	}
	
	FlushPending(FlushLatestAndClear=false)
	{
		//	if there are promises and data's waiting, we can flush next
		if ( this.Promises.length == 0 )
			return;
		if ( this.PendingValues.length == 0 )
			return;
		
		//	flush 0 (FIFO)
		//	we pre-pop as we want all listeners to get the same value
		if (FlushLatestAndClear && this.PendingValues.length > 1)
		{
			Pop.Warning(`Promise queue FlushLatest dropping ${this.PendingValues.length - 1} elements`);
		}
		const Value0 = FlushLatestAndClear ? this.PendingValues.splice(0,this.PendingValues.length).pop() : this.PendingValues.shift();
		const HandlePromise = function(Promise)
		{
			if ( Value0.RejectionValues )
				Promise.Reject( ...Value0.RejectionValues );
			else
				Promise.Resolve( ...Value0.ResolveValues );
		}
		
		//	pop array incase handling results in more promises, so we avoid infinite loop
		const Promises = this.Promises.splice(0);
		//	need to try/catch here otherwise some will be lost
		Promises.forEach( HandlePromise );
	}
	
	Resolve()
	{
		throw "PromiseQueue.Resolve() has been deprecated for Push() to enforce the pattern that we're handling a queue of values";
	}
	
	//	reject all the current promises
	Reject()
	{
		const Args = Array.from(arguments);
		const Value = {};
		Value.RejectionValues = Args;
		this.PendingValues.push(Value);
		this.FlushPending();
	}
}






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
