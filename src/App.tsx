import { useEffect, useState, } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Analytics } from '@vercel/analytics/react';

const CLIENT_ID = "1416651287163965471";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function App() {
  const [game, setGame] = useState(new Chess());
  const [status, setStatus] = useState('Initializing...');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isBrowserMode, setIsBrowserMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Game State
  const [whiteTime, setWhiteTime] = useState(300);
  const [blackTime, setBlackTime] = useState(300);
  const [gameOver, setGameOver] = useState(false);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("ai");
  const [_, setDifficulty] = useState("capn_cope");
  const [whitePlayerId, setWhitePlayerId] = useState<string | null>(null);
  const [blackPlayerId, setBlackPlayerId] = useState<string | null>(null);
  const [turn, setTurn] = useState("w");

  // Setup options
  const [setupMode, setSetupMode] = useState("ai");
  const [setupDiff, setSetupDiff] = useState("capn_cope");
  const [setupTime, setSetupTime] = useState(300);

  useEffect(() => {
    let ws: WebSocket | null = null;
    
    async function init() {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const isDiscord = urlParams.has('frame_id');
        setIsBrowserMode(!isDiscord);
        
        let API_BASE = "https://ws.goblinlife.org";
        let WS_BASE = "wss://ws.goblinlife.org";
        
        if (isDiscord) {
          API_BASE = `https://${CLIENT_ID}.discordsays.com/ws`;
          WS_BASE = `wss://${CLIENT_ID}.discordsays.com/ws`;
        }

        setStatus("Fetching config...");
        const res = await fetch(`${API_BASE}/games/chess/config`);
        const configData = await res.json();

        if (!configData.client_id) {
          throw new Error("No client ID returned");
        }

        let gameId = urlParams.get('game_id') || "test_game_123";
        let uid = "human_" + Math.floor(Math.random() * 100000);

        if (isDiscord) {
          setStatus("Waiting for Discord SDK...");
          const discordSdk = new DiscordSDK(CLIENT_ID);
          await discordSdk.ready();
          
          setStatus("Authorizing with Discord...");
          await discordSdk.commands.authorize({
            client_id: CLIENT_ID,
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify"]
          });

          // Wait, we don't have a token exchange backend here, but we can just use the user ID if the SDK exposes it.
          // Wait, the Discord Activity SDK `discordSdk.channelId` is available.
          if (!discordSdk.channelId) {
            throw new Error("Could not get channel ID");
          }
          gameId = discordSdk.channelId;
          
          // Without token exchange, we don't get discordSdk.user directly.
          // Let's use the instance ID as a user identifier for now.
          uid = discordSdk.instanceId || uid;
        }

        setUserId(uid);

        setStatus("Connecting to game server...");
        const wsUrl = `${WS_BASE}/games/chess/ws/showdown`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setStatus("Connected");
          ws?.send(JSON.stringify({ action: "join", game_id: gameId, user_id: uid }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.action === "update") {
            const newGame = new Chess();
            newGame.load(data.fen);
            setGame(newGame);
            setWhiteTime(data.white_time);
            setBlackTime(data.black_time);
            setGameOver(data.game_over);
            setReason(data.reason);
            setMode(data.mode);
            setDifficulty(data.difficulty);
            setWhitePlayerId(data.white_player_id);
            setBlackPlayerId(data.black_player_id);
            setTurn(data.turn);
          }
        };

        ws.onerror = () => setStatus("WebSocket Error");
        ws.onclose = () => setStatus("Disconnected");

        setSocket(ws);

      } catch (err: any) {
        setStatus(`Error: ${err.message}`);
        console.error(err);
      }
    }

    init();
    
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  // Update clocks locally every second for smooth UI
  useEffect(() => {
    if (gameOver) return;
    const interval = setInterval(() => {
      if (turn === "w") {
        setWhiteTime(t => Math.max(0, t - 1));
      } else {
        setBlackTime(t => Math.max(0, t - 1));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [turn, gameOver]);

  function onDrop(sourceSquare: string, targetSquare: string, piece: string) {
    if (gameOver) return false;
    
    const gameCopy = new Chess(game.fen());
    try {
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: piece[1].toLowerCase() ?? 'q'
      });

      if (move === null) return false;
      
      setGame(gameCopy);
      
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          action: "move",
          uci: move.from + move.to + (move.promotion || ""),
          user_id: userId
        }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function handleSetup() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: "setup",
        mode: setupMode,
        difficulty: setupDiff,
        time: setupTime
      }));
    }
  }

  function handleClaim(seat: string) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        action: "claim_seat",
        seat,
        user_id: userId
      }));
    }
  }

  const orientation = (blackPlayerId === userId && whitePlayerId !== userId) ? "black" : "white";

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif', display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
      
      {/* Sidebar Controls */}
      <div style={{ flex: '1', minWidth: '250px', background: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '24px' }}>Goblin Chess</h1>
        <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#666' }}>
          Status: <span style={{ color: status === 'Connected' ? 'green' : 'red', fontWeight: 'bold' }}>{status}</span>
          <br/>
          {isBrowserMode && <span>(Browser Mode)</span>}
        </p>

        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '6px', marginBottom: '20px', background: 'white' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Game Setup</h3>
          
          <label style={{ display: 'block', marginBottom: '10px' }}>
            <span style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>Mode</span>
            <select value={setupMode} onChange={e => setSetupMode(e.target.value)} style={{ width: '100%', padding: '6px' }}>
              <option value="ai">Player vs AI</option>
              <option value="pvp">Player vs Player</option>
            </select>
          </label>

          {setupMode === "ai" && (
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <span style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>AI Opponent</span>
              <select value={setupDiff} onChange={e => setSetupDiff(e.target.value)} style={{ width: '100%', padding: '6px' }}>
                <option value="tater_nate">Tater Nate (Random Moves)</option>
                <option value="capn_cope">Cap'n Cope (Easy)</option>
                <option value="hr">HR Department (Hard)</option>
              </select>
            </label>
          )}

          <label style={{ display: 'block', marginBottom: '15px' }}>
            <span style={{ display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px' }}>Time Control</span>
            <select value={setupTime} onChange={e => setSetupTime(Number(e.target.value))} style={{ width: '100%', padding: '6px' }}>
              <option value={60}>1 Minute</option>
              <option value={180}>3 Minutes</option>
              <option value={300}>5 Minutes</option>
              <option value={600}>10 Minutes</option>
            </select>
          </label>

          <button 
            onClick={handleSetup} 
            style={{ width: '100%', padding: '10px', background: '#5865F2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Start New Game
          </button>
        </div>

        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '6px', background: 'white' }}>
          <h3 style={{ margin: '0 0 10px 0' }}>Seats</h3>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span>White: {whitePlayerId === userId ? '(You)' : whitePlayerId ? 'Taken' : 'Open'}</span>
            {!whitePlayerId && <button onClick={() => handleClaim('white')} style={{ padding: '4px 8px', cursor: 'pointer' }}>Claim</button>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Black: {mode === "ai" ? 'AI' : blackPlayerId === userId ? '(You)' : blackPlayerId ? 'Taken' : 'Open'}</span>
            {mode === "pvp" && !blackPlayerId && <button onClick={() => handleClaim('black')} style={{ padding: '4px 8px', cursor: 'pointer' }}>Claim</button>}
          </div>
        </div>
      </div>

      {/* Board Area */}
      <div style={{ flex: '2', minWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {reason && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 20px', borderRadius: '6px', marginBottom: '15px', fontWeight: 'bold' }}>
            {reason}
          </div>
        )}

        <div style={{ width: '100%', maxWidth: '450px', background: '#333', color: 'white', padding: '10px 15px', borderRadius: '6px 6px 0 0', display: 'flex', justifyContent: 'space-between' }}>
          <span>{orientation === "white" ? "Black" : "White"}</span>
          <span style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace' }}>
            {formatTime(orientation === "white" ? blackTime : whiteTime)}
          </span>
        </div>

        <div style={{ width: '100%', maxWidth: '450px', borderLeft: '2px solid #333', borderRight: '2px solid #333' }}>
          <Chessboard 
            position={game.fen()} 
            onPieceDrop={onDrop}
            boardOrientation={orientation}
          />
        </div>

        <div style={{ width: '100%', maxWidth: '450px', background: '#eee', padding: '10px 15px', borderRadius: '0 0 6px 6px', display: 'flex', justifyContent: 'space-between', border: '2px solid #333' }}>
          <span style={{ fontWeight: 'bold' }}>{orientation === "white" ? "White" : "Black"} (You)</span>
          <span style={{ fontSize: '20px', fontWeight: 'bold', fontFamily: 'monospace' }}>
            {formatTime(orientation === "white" ? whiteTime : blackTime)}
          </span>
        </div>
      </div>

      <Analytics />
    </div>
  );
}

export default App;
