const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// CORS ayarları - Tüm originlere izin ver (test için)
app.use(cors({
  origin: "*",
  credentials: true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// Socket.io yapılandırması - Render için optimize edilmiş
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Render için WebSocket ayarları
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Static dosyalar
app.use(express.static('public'));

// Oyun durumu
const games = new Map();
const waitingPlayers = [];

// Ana sayfa
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket bağlantıları
io.on('connection', (socket) => {
  console.log('Oyuncu bağlandı:', socket.id);

  // Oyun arama
  socket.on('findGame', (playerName) => {
    socket.playerName = playerName;
    
    if (waitingPlayers.length > 0) {
      // Mevcut bekleyen oyuncuyla eşleştir
      const opponent = waitingPlayers.shift();
      const gameId = `game_${Date.now()}`;
      
      const gameState = {
        id: gameId,
        players: {
          white: { id: opponent.id, name: opponent.playerName },
          black: { id: socket.id, name: playerName }
        },
        board: initializeBoard(),
        currentTurn: 'white',
        status: 'playing'
      };
      
      games.set(gameId, gameState);
      
      // Her iki oyuncuyu da oyun odasına al
      socket.join(gameId);
      opponent.join(gameId);
      
      // Oyun başlangıcını bildir
      io.to(gameId).emit('gameStart', gameState);
      
    } else {
      // Bekleyen oyuncular listesine ekle
      waitingPlayers.push(socket);
      socket.emit('waiting');
    }
  });

  // Hamle yapma
  socket.on('makeMove', (data) => {
    const { gameId, from, to } = data;
    const game = games.get(gameId);
    
    if (!game) return;
    
    // Sıra kontrolü
    const isWhitePlayer = game.players.white.id === socket.id;
    const isBlackPlayer = game.players.black.id === socket.id;
    
    if ((game.currentTurn === 'white' && !isWhitePlayer) || 
        (game.currentTurn === 'black' && !isBlackPlayer)) {
      return;
    }
    
    // Hamle geçerliliği kontrolü (basit)
    if (isValidMove(game.board, from, to, game.currentTurn)) {
      // Hamleyi uygula
      game.board[to.row][to.col] = game.board[from.row][from.col];
      game.board[from.row][from.col] = null;
      
      // Sırayı değiştir
      game.currentTurn = game.currentTurn === 'white' ? 'black' : 'white';
      
      // Tüm oyunculara hamleyi bildir
      io.to(gameId).emit('moveMade', {
        from,
        to,
        board: game.board,
        currentTurn: game.currentTurn
      });
    }
  });

  // Bağlantı kopması
  socket.on('disconnect', () => {
    console.log('Oyuncu ayrıldı:', socket.id);
    
    // Bekleyen oyuncular listesinden çıkar
    const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.id);
    if (waitingIndex > -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // Aktif oyunlarda kontrol et
    for (const [gameId, game] of games.entries()) {
      if (game.players.white.id === socket.id || game.players.black.id === socket.id) {
        io.to(gameId).emit('playerDisconnected');
        games.delete(gameId);
        break;
      }
    }
  });
});

// Satranç tahtası başlangıç durumu
function initializeBoard() {
  const board = Array(8).fill(null).map(() => Array(8).fill(null));
  
  // Beyaz taşlar
  board[7] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'].map(piece => ({ type: piece, color: 'white' }));
  board[6] = Array(8).fill({ type: 'pawn', color: 'white' });
  
  // Siyah taşlar
  board[0] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'].map(piece => ({ type: piece, color: 'black' }));
  board[1] = Array(8).fill({ type: 'pawn', color: 'black' });
  
  return board;
}

// Basit hamle geçerliliği kontrolü
function isValidMove(board, from, to, currentTurn) {
  const piece = board[from.row][from.col];
  if (!piece || piece.color !== currentTurn) return false;
  
  const targetPiece = board[to.row][to.col];
  if (targetPiece && targetPiece.color === currentTurn) return false;
  
  // Basit kontroller (gerçek satranç kuralları için genişletilebilir)
  return true;
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});