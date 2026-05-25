const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameRoom } = require('./game/GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room storage (swap with DB adapter later)
const rooms = new Map();

// Cleanup stale rooms every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
        if (now - room.lastActivity > 30 * 60 * 1000) {
            rooms.delete(code);
            console.log(`Cleaned up stale room: ${code}`);
        }
    }
}, 5 * 60 * 1000);

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (rooms.has(code));
    return code;
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    let currentRoom = null;
    let playerName = null;

    // Create a new room
    socket.on('create-room', ({ name, rounds }) => {
        const code = generateRoomCode();
        const room = new GameRoom(code, rounds || 5);
        rooms.set(code, room);

        playerName = name;
        currentRoom = code;
        room.addPlayer(socket.id, name, true);
        socket.join(code);
        room.lastActivity = Date.now();

        socket.emit('room-created', { code, players: room.getPlayerList() });
        console.log(`Room ${code} created by ${name}`);
    });

    // Join an existing room
    socket.on('join-room', ({ code, name }) => {
        const roomCode = code.toUpperCase();
        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit('error-msg', { message: 'Room not found' });
            return;
        }
        if (room.status !== 'lobby') {
            socket.emit('error-msg', { message: 'Game already in progress' });
            return;
        }
        if (room.players.size >= 8) {
            socket.emit('error-msg', { message: 'Room is full (max 8 players)' });
            return;
        }
        if (room.hasPlayerName(name)) {
            socket.emit('error-msg', { message: 'Name already taken in this room' });
            return;
        }

        playerName = name;
        currentRoom = roomCode;
        room.addPlayer(socket.id, name, false);
        socket.join(roomCode);
        room.lastActivity = Date.now();

        socket.emit('room-joined', { code: roomCode, players: room.getPlayerList() });
        io.to(roomCode).emit('player-joined', { players: room.getPlayerList() });
        console.log(`${name} joined room ${roomCode}`);
    });

    // Host starts the game
    socket.on('start-game', () => {
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isHost) {
            socket.emit('error-msg', { message: 'Only the host can start the game' });
            return;
        }
        if (room.players.size < 2) {
            socket.emit('error-msg', { message: 'Need at least 2 players' });
            return;
        }

        room.startGame();
        room.lastActivity = Date.now();

        io.to(currentRoom).emit('game-started', {
            round: room.currentRound,
            totalRounds: room.totalRounds,
            letter: room.currentLetter,
            timeLimit: room.timeLimit
        });

        startRoundTimer(currentRoom);
    });

    // Player submits answers
    socket.on('submit-answers', ({ answers }) => {
        const room = rooms.get(currentRoom);
        if (!room || room.status !== 'playing') return;

        room.submitAnswer(socket.id, answers);
        room.lastActivity = Date.now();

        io.to(currentRoom).emit('player-submitted', {
            playerId: socket.id,
            submittedCount: room.getSubmittedCount(),
            totalPlayers: room.players.size
        });

        if (room.allAnswersSubmitted()) {
            clearRoomTimer(currentRoom);
            beginChallengePhase(currentRoom);
        }
    });

    // Player challenges an answer
    socket.on('challenge-answer', ({ targetPlayerId, category }) => {
        const room = rooms.get(currentRoom);
        if (!room || room.status !== 'challenging') return;

        const challenge = room.addChallenge(socket.id, targetPlayerId, category);
        if (!challenge) return;

        room.lastActivity = Date.now();

        // Broadcast the new challenge to all players
        io.to(currentRoom).emit('challenge-added', {
            challenge: {
                id: challenge.id,
                challengerName: challenge.challengerName,
                targetPlayerId: challenge.targetPlayerId,
                targetPlayerName: challenge.targetPlayerName,
                category: challenge.category,
                answer: challenge.answer,
                resolved: challenge.resolved,
                result: challenge.result
            }
        });

        // In 2-player game, challenge auto-resolves
        if (challenge.resolved) {
            io.to(currentRoom).emit('challenge-resolved', {
                challengeId: challenge.id,
                result: challenge.result
            });
        }
    });

    // Player votes on a challenge
    socket.on('vote-challenge', ({ challengeId, vote }) => {
        const room = rooms.get(currentRoom);
        if (!room || room.status !== 'challenging') return;

        const result = room.voteOnChallenge(socket.id, challengeId, vote);
        if (!result) return;

        room.lastActivity = Date.now();

        // Notify vote received
        io.to(currentRoom).emit('vote-received', {
            challengeId: challengeId,
            voteCount: result.challenge.votes.size,
            eligibleVoters: room.getEligibleVoters(result.challenge).length
        });

        // If all voted, broadcast resolution
        if (result.allVoted) {
            io.to(currentRoom).emit('challenge-resolved', {
                challengeId: challengeId,
                result: result.challenge.result
            });

            // Check if all challenges are now resolved
            if (room.allChallengesResolved()) {
                // Small delay so clients can see the resolution
                setTimeout(() => finishRoundAfterChallenges(currentRoom), 1500);
            }
        }
    });

    // Player signals they have no challenges (skip)
    socket.on('no-challenges', () => {
        // This is informational — the timer handles the actual progression
    });

    // Host triggers next round
    socket.on('next-round', () => {
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isHost) return;

        if (room.hasMoreRounds()) {
            room.startNextRound();
            room.lastActivity = Date.now();

            io.to(currentRoom).emit('round-started', {
                round: room.currentRound,
                totalRounds: room.totalRounds,
                letter: room.currentLetter,
                timeLimit: room.timeLimit
            });

            startRoundTimer(currentRoom);
        } else {
            room.status = 'finished';
            io.to(currentRoom).emit('game-over', {
                standings: room.getStandings()
            });
        }
    });

    // Host ends game early
    socket.on('end-game', () => {
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isHost) return;

        clearRoomTimer(currentRoom);
        clearChallengeTimer(currentRoom);
        room.status = 'finished';
        room.lastActivity = Date.now();

        io.to(currentRoom).emit('game-over', {
            standings: room.getStandings()
        });
    });

    // Play again (host resets room)
    socket.on('play-again', () => {
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (!player || !player.isHost) return;

        room.reset();
        room.lastActivity = Date.now();

        io.to(currentRoom).emit('back-to-lobby', {
            players: room.getPlayerList()
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const wasHost = room.players.get(socket.id)?.isHost;
                room.removePlayer(socket.id);

                if (room.players.size === 0) {
                    clearRoomTimer(currentRoom);
                    clearChallengeTimer(currentRoom);
                    rooms.delete(currentRoom);
                    console.log(`Room ${currentRoom} deleted (empty)`);
                } else {
                    if (wasHost) {
                        room.assignNewHost();
                    }
                    io.to(currentRoom).emit('player-left', {
                        players: room.getPlayerList(),
                        playerName: playerName
                    });

                    if (room.status === 'playing' && room.allAnswersSubmitted()) {
                        clearRoomTimer(currentRoom);
                        beginChallengePhase(currentRoom);
                    }

                    // If in challenge phase and all challenges resolved after disconnect
                    if (room.status === 'challenging' && room.challenges.size > 0 && room.allChallengesResolved()) {
                        finishRoundAfterChallenges(currentRoom);
                    }
                }
            }
        }
    });
});

// ============ TIMER MANAGEMENT ============

const roomTimers = new Map();
const challengeTimers = new Map();

function startRoundTimer(roomCode) {
    clearRoomTimer(roomCode);

    const room = rooms.get(roomCode);
    if (!room) return;

    let timeLeft = room.timeLimit;

    const timer = setInterval(() => {
        timeLeft--;
        io.to(roomCode).emit('timer-tick', { timeLeft });

        if (timeLeft <= 0) {
            clearRoomTimer(roomCode);
            beginChallengePhase(roomCode);
        }
    }, 1000);

    roomTimers.set(roomCode, timer);
}

function clearRoomTimer(roomCode) {
    const timer = roomTimers.get(roomCode);
    if (timer) {
        clearInterval(timer);
        roomTimers.delete(roomCode);
    }
}

function startChallengeTimer(roomCode) {
    clearChallengeTimer(roomCode);

    const room = rooms.get(roomCode);
    if (!room) return;

    let timeLeft = room.challengeTimeLimit;

    const timer = setInterval(() => {
        timeLeft--;
        io.to(roomCode).emit('challenge-timer-tick', { timeLeft });

        if (timeLeft <= 0) {
            clearChallengeTimer(roomCode);
            // Force-resolve any pending challenges and finalize
            room.forceResolveChallenges();
            finishRoundAfterChallenges(roomCode);
        }
    }, 1000);

    challengeTimers.set(roomCode, timer);
}

function clearChallengeTimer(roomCode) {
    const timer = challengeTimers.get(roomCode);
    if (timer) {
        clearInterval(timer);
        challengeTimers.delete(roomCode);
    }
}

// ============ GAME FLOW ============

function beginChallengePhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const preliminaryResults = room.beginChallengePhase();

    io.to(roomCode).emit('challenge-phase-started', {
        round: room.currentRound,
        letter: room.currentLetter,
        results: preliminaryResults,
        challengeTimeLimit: room.challengeTimeLimit
    });

    startChallengeTimer(roomCode);
}

function finishRoundAfterChallenges(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'challenging') return;

    clearChallengeTimer(roomCode);

    const finalResults = room.finalizeScores();

    io.to(roomCode).emit('round-results', {
        round: room.currentRound,
        letter: room.currentLetter,
        results: finalResults,
        challenges: room.getChallengesForClient(),
        standings: room.getStandings(),
        hasMoreRounds: room.hasMoreRounds()
    });
}

server.listen(PORT, () => {
    console.log(`\n🎯 Name, Place, Animal, Thing - Multiplayer`);
    console.log(`   Server running at http://localhost:${PORT}`);
    console.log(`   Share this URL with players on the same network\n`);
});
