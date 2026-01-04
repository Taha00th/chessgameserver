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

// API endpoint - Frontend Vercel'de olduğu için sadece JSON response
app.get('/', (req, res) => {
  res.json({ 
    message: 'Chess Game Backend Server', 
    status: 'running',
    endpoints: {
      socket: '/socket.io/',
      health: '/'
    }
  });
});

// Oyun durumu
const games = new Map();
const waitingPlayers = [];
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

// Satranç kuralları - Gerçek hamle kontrolü
function isValidMove(board, from, to, currentTurn) {
  const piece = board[from.row][from.col];
  if (!piece || piece.color !== currentTurn) return false;
  
  const targetPiece = board[to.row][to.col];
  if (targetPiece && targetPiece.color === currentTurn) return false;
  
  const rowDiff = Math.abs(to.row - from.row);
  const colDiff = Math.abs(to.col - from.col);
  
  switch (piece.type) {
      case 'pawn':
          return isValidPawnMove(board, from, to, piece.color);
      case 'rook':
          return isValidRookMove(board, from, to);
      case 'knight':
          return isValidKnightMove(from, to);
      case 'bishop':
          return isValidBishopMove(board, from, to);
      case 'queen':
          return isValidQueenMove(board, from, to);
      case 'king':
          return isValidKingMove(from, to);
      default:
          return false;
  }
}

// Piyon hareketi
function isValidPawnMove(board, from, to, color) {
  const direction = color === 'white' ? -1 : 1;
  const startRow = color === 'white' ? 6 : 1;
  const rowDiff = to.row - from.row;
  const colDiff = Math.abs(to.col - from.col);
  
  // İleri hareket
  if (colDiff === 0) {
      if (board[to.row][to.col]) return false; // Önünde taş var
      
      if (rowDiff === direction) return true; // Bir kare ileri
      if (from.row === startRow && rowDiff === 2 * direction) return true; // İlk hamle 2 kare
  }
  
  // Çapraz alma
  if (colDiff === 1 && rowDiff === direction) {
      return board[to.row][to.col] && board[to.row][to.col].color !== color;
  }
  
  return false;
}

// Kale hareketi (düz çizgi)
function isValidRookMove(board, from, to) {
  if (from.row !== to.row && from.col !== to.col) return false;
  return isPathClear(board, from, to);
}

// At hareketi (L şekli)
function isValidKnightMove(from, to) {
  const rowDiff = Math.abs(to.row - from.row);
  const colDiff = Math.abs(to.col - from.col);
  return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
}

// Fil hareketi (çapraz)
function isValidBishopMove(board, from, to) {
  const rowDiff = Math.abs(to.row - from.row);
  const colDiff = Math.abs(to.col - from.col);
  if (rowDiff !== colDiff) return false;
  return isPathClear(board, from, to);
}

// Vezir hareketi (kale + fil)
function isValidQueenMove(board, from, to) {
  return isValidRookMove(board, from, to) || isValidBishopMove(board, from, to);
}

// Şah hareketi (bir kare her yöne)
function isValidKingMove(from, to) {
  const rowDiff = Math.abs(to.row - from.row);
  const colDiff = Math.abs(to.col - from.col);
  return rowDiff <= 1 && colDiff <= 1;
}

// Yol temiz mi kontrol et
function isPathClear(board, from, to) {
  const rowStep = to.row > from.row ? 1 : to.row < from.row ? -1 : 0;
  const colStep = to.col > from.col ? 1 : to.col < from.col ? -1 : 0;
  
  let currentRow = from.row + rowStep;
  let currentCol = from.col + colStep;
  
  while (currentRow !== to.row || currentCol !== to.col) {
      if (board[currentRow][currentCol]) return false;
      currentRow += rowStep;
      currentCol += colStep;
  }
  
  return true;
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
