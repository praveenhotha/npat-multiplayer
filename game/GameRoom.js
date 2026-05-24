/**
 * GameRoom - Server-side game state management.
 * 
 * Designed for easy persistence: call toJSON() to serialize entire room state.
 * To restore: GameRoom.fromJSON(data) (not yet implemented, but structure supports it).
 */

class GameRoom {
    constructor(code, totalRounds = 5) {
        this.code = code;
        this.totalRounds = totalRounds;
        this.timeLimit = 30; // seconds per round
        this.players = new Map(); // socketId -> PlayerState
        this.currentRound = 0;
        this.currentLetter = '';
        this.usedLetters = [];
        this.rounds = []; // completed round data
        this.currentAnswers = new Map(); // socketId -> answers
        this.status = 'lobby'; // lobby | playing | scoring | finished
        this.lastActivity = Date.now();
        this.createdAt = new Date().toISOString();
    }

    addPlayer(socketId, name, isHost) {
        this.players.set(socketId, {
            id: socketId,
            name: name,
            isHost: isHost,
            totalScore: 0,
            connected: true
        });
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        this.currentAnswers.delete(socketId);
    }

    hasPlayerName(name) {
        for (const player of this.players.values()) {
            if (player.name.toLowerCase() === name.toLowerCase()) return true;
        }
        return false;
    }

    assignNewHost() {
        const firstPlayer = this.players.values().next().value;
        if (firstPlayer) {
            firstPlayer.isHost = true;
        }
    }

    getPlayerList() {
        return Array.from(this.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            totalScore: p.totalScore
        }));
    }

    startGame() {
        this.status = 'playing';
        this.currentRound = 0;
        this.usedLetters = [];
        this.rounds = [];
        // Reset scores
        for (const player of this.players.values()) {
            player.totalScore = 0;
        }
        this.startNextRound();
    }

    startNextRound() {
        this.currentRound++;
        this.currentLetter = this.pickRandomLetter();
        this.usedLetters.push(this.currentLetter);
        this.currentAnswers = new Map();
        this.status = 'playing';
    }

    pickRandomLetter() {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const available = alphabet.split('').filter(l => !this.usedLetters.includes(l));
        if (available.length === 0) {
            this.usedLetters = [];
            return alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        return available[Math.floor(Math.random() * available.length)];
    }

    submitAnswer(socketId, answers) {
        if (!this.players.has(socketId)) return;
        this.currentAnswers.set(socketId, {
            name: (answers.name || '').trim(),
            place: (answers.place || '').trim(),
            animal: (answers.animal || '').trim(),
            thing: (answers.thing || '').trim()
        });
    }

    getSubmittedCount() {
        return this.currentAnswers.size;
    }

    allAnswersSubmitted() {
        return this.currentAnswers.size >= this.players.size;
    }

    scoreCurrentRound() {
        const categories = ['name', 'place', 'animal', 'thing'];
        const letter = this.currentLetter;
        const results = [];

        // Build answer arrays per player
        const playerAnswers = [];
        for (const [socketId, player] of this.players) {
            const answers = this.currentAnswers.get(socketId) || { name: '', place: '', animal: '', thing: '' };
            playerAnswers.push({
                playerId: socketId,
                playerName: player.name,
                answers: answers,
                scores: { name: 0, place: 0, animal: 0, thing: 0 },
                roundTotal: 0
            });
        }

        // Score each category
        for (const category of categories) {
            const answerGroups = new Map(); // normalized answer -> [playerIds]

            for (const pa of playerAnswers) {
                const value = pa.answers[category].toLowerCase().trim();
                if (value && this.isValidAnswer(value, letter)) {
                    if (!answerGroups.has(value)) {
                        answerGroups.set(value, []);
                    }
                    answerGroups.get(value).push(pa.playerId);
                }
            }

            for (const pa of playerAnswers) {
                const value = pa.answers[category].toLowerCase().trim();
                if (!value || !this.isValidAnswer(value, letter)) {
                    pa.scores[category] = 0;
                } else {
                    const group = answerGroups.get(value);
                    pa.scores[category] = group.length === 1 ? 10 : 5;
                }
            }
        }

        // Calculate totals and update player scores
        for (const pa of playerAnswers) {
            pa.roundTotal = Object.values(pa.scores).reduce((sum, s) => sum + s, 0);
            const player = this.players.get(pa.playerId);
            if (player) {
                player.totalScore += pa.roundTotal;
            }
            results.push(pa);
        }

        // Store round history
        this.rounds.push({
            roundNumber: this.currentRound,
            letter: letter,
            results: results
        });

        return results;
    }

    isValidAnswer(answer, letter) {
        return answer.length > 0 && answer[0].toLowerCase() === letter.toLowerCase();
    }

    hasMoreRounds() {
        return this.currentRound < this.totalRounds;
    }

    getStandings() {
        return Array.from(this.players.values())
            .map(p => ({ name: p.name, score: p.totalScore, isHost: p.isHost }))
            .sort((a, b) => b.score - a.score);
    }

    reset() {
        this.status = 'lobby';
        this.currentRound = 0;
        this.usedLetters = [];
        this.rounds = [];
        this.currentAnswers = new Map();
        for (const player of this.players.values()) {
            player.totalScore = 0;
        }
    }

    toJSON() {
        return {
            code: this.code,
            totalRounds: this.totalRounds,
            timeLimit: this.timeLimit,
            players: this.getPlayerList(),
            currentRound: this.currentRound,
            currentLetter: this.currentLetter,
            usedLetters: this.usedLetters,
            rounds: this.rounds,
            status: this.status,
            createdAt: this.createdAt
        };
    }
}

module.exports = { GameRoom };
