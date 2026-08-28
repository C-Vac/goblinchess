import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { Analytics } from '@vercel/analytics/react';

const CLIENT_ID = "1416651287163965471";

function App() {
  const [game, setGame] = useState(new Chess());
  const [status, setStatus] = useState('Initializing...');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isBrowserMode, setIsBrowserMode] = useState(false);

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

          if (!discordSdk.channelId) {
            throw new Error("Could not get channel ID");
          }
          gameId = discordSdk.channelId;
        }

        setStatus("Connecting to game server...");
        const wsUrl = `${WS_BASE}/games/chess/ws/showdown`;
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setStatus("Connected");
          ws?.send(JSON.stringify({ action: "join", game_id: gameId }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.action === "update") {
            const newGame = new Chess();
            newGame.load(data.fen);
            setGame(newGame);
          } else if (data.action === "error") {
            setStatus("Error: " + data.message);
          } else if (data.action === "sync") {
            console.log("Sync", data.players);
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

  function onDrop(sourceSquare: string, targetSquare: string, piece: string) {
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
          move: move.san
        }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h1>Goblin Chess Showdown</h1>
      <p style={{ fontWeight: 'bold' }}>
        Status: <span style={{ color: status === 'Connected' ? 'green' : 'inherit' }}>{status}</span> {isBrowserMode && "(Browser Mode)"}
      </p>
      
      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center' }}>
        <Chessboard 
          position={game.fen()} 
          onPieceDrop={onDrop}
          boardWidth={400}
        />
      </div>

      <Analytics />
    </div>
  );
}

export default App;
