/**
 * GameRoom - Server-side game state management.
 * 
 * Game flow: lobby → playing → challenging → scoring → (next round or finished)
 * 
 * Challenge phase: After answers are revealed, players can challenge answers
 * they believe are invalid. Other players vote, majority decides.
 */

class GameRoom {
    constructor(code, totalRounds = 5) {
        this.code = code;
        this.totalRounds = totalRounds;
        this.timeLimit = 30; // seconds per answer round
        this.challengeTimeLimit = 15; // seconds for challenge phase
        this.players = new Map(); // socketId -> PlayerState
        this.currentRound = 0;
        this.currentLetter = '';
        this.usedLetters = [];
        this.rounds = []; // completed round data
        this.currentAnswers = new Map(); // socketId -> answers
        this.status = 'lobby'; // lobby | playing | challenging | scoring | finished
        this.lastActivity = Date.now();
        this.createdAt = new Date().toISOString();

        // Challenge state
        this.challenges = new Map(); // challengeId -> Challenge object
        this.challengeIdCounter = 0;
        this.preliminaryResults = null; // results before challenge adjustments
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
        // Remove their votes from active challenges
        for (const challenge of this.challenges.values()) {
            challenge.votes.delete(socketId);
        }
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
        this.challenges = new Map();
        this.preliminaryResults = null;
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

    // ============ CHALLENGE PHASE ============

    /**
     * Begin the challenge phase. Compute preliminary scores and reveal answers.
     * Returns the preliminary results for display.
     */
    beginChallengePhase() {
        this.status = 'challenging';
        this.challenges = new Map();
        this.preliminaryResults = this.computeScores();
        return this.preliminaryResults;
    }

    /**
     * Get answers that are eligible for challenge (non-empty, starts with correct letter).
     * Returns list of { playerId, playerName, category, answer }
     */
    getChallengeableAnswers() {
        const categories = ['name', 'place', 'animal', 'thing'];
        const challengeable = [];

        for (const [socketId, player] of this.players) {
            const answers = this.currentAnswers.get(socketId) || {};
            for (const cat of categories) {
                const value = (answers[cat] || '').trim();
                if (value && this.isValidAnswer(value, this.currentLetter)) {
                    challengeable.push({
                        playerId: socketId,
                        playerName: player.name,
                        category: cat,
                        answer: value
                    });
                }
            }
        }
        return challengeable;
    }

    /**
     * A player challenges another player's answer.
     * Returns the challenge object or null if invalid.
     */
    addChallenge(challengerId, targetPlayerId, category) {
        // Can't challenge your own answer
        if (challengerId === targetPlayerId) return null;
        // Must be in challenge phase
        if (this.status !== 'challenging') return null;
        // Target must exist
        if (!this.players.has(targetPlayerId)) return null;
        // Check answer exists and is valid (starts with letter)
        const answers = this.currentAnswers.get(targetPlayerId);
        if (!answers) return null;
        const value = (answers[category] || '').trim();
        if (!value || !this.isValidAnswer(value, this.currentLetter)) return null;

        // Check for duplicate challenge (same target + category)
        for (const existing of this.challenges.values()) {
            if (existing.targetPlayerId === targetPlayerId && existing.category === category) {
                return null; // Already challenged
            }
        }

        const challengeId = `ch_${++this.challengeIdCounter}`;
        const challenge = {
            id: challengeId,
            challengerId: challengerId,
            challengerName: this.players.get(challengerId).name,
            targetPlayerId: targetPlayerId,
            targetPlayerName: this.players.get(targetPlayerId).name,
            category: category,
            answer: value,
            votes: new Map(), // socketId -> 'accept' | 'reject'
            resolved: false,
            result: null // 'accepted' (answer stays) | 'rejected' (answer = 0)
        };

        this.challenges.set(challengeId, challenge);

        // In 2-player game, the challenger's challenge auto-succeeds
        if (this.players.size === 2) {
            challenge.result = 'rejected';
            challenge.resolved = true;
        }

        return challenge;
    }

    /**
     * A player votes on a challenge.
     * Returns { challenge, allVoted } or null if invalid.
     */
    voteOnChallenge(voterId, challengeId, vote) {
        const challenge = this.challenges.get(challengeId);
        if (!challenge || challenge.resolved) return null;
        // Can't vote on your own answer's challenge
        if (voterId === challenge.targetPlayerId) return null;
        // Challenger already implicitly voted 'reject'
        if (voterId === challenge.challengerId) return null;

        challenge.votes.set(voterId, vote); // 'accept' or 'reject'

        // Check if all eligible voters have voted
        const eligibleVoters = this.getEligibleVoters(challenge);
        const allVoted = challenge.votes.size >= eligibleVoters.length;

        if (allVoted) {
            this.resolveChallenge(challenge);
        }

        return { challenge, allVoted };
    }

    /**
     * Get players eligible to vote on a challenge (everyone except target and challenger).
     */
    getEligibleVoters(challenge) {
        const voters = [];
        for (const [socketId] of this.players) {
            if (socketId !== challenge.targetPlayerId && socketId !== challenge.challengerId) {
                voters.push(socketId);
            }
        }
        return voters;
    }

    /**
     * Resolve a challenge based on votes. Majority reject = answer invalidated.
     */
    resolveChallenge(challenge) {
        if (challenge.resolved) return;

        let acceptCount = 0;
        let rejectCount = 1; // Challenger implicitly rejects

        for (const vote of challenge.votes.values()) {
            if (vote === 'accept') acceptCount++;
            else rejectCount++;
        }

        // Majority reject = answer invalidated. Tie = answer stays.
        challenge.result = rejectCount > acceptCount ? 'rejected' : 'accepted';
        challenge.resolved = true;
    }

    /**
     * Check if all challenges are resolved.
     */
    allChallengesResolved() {
        if (this.challenges.size === 0) return true;
        for (const challenge of this.challenges.values()) {
            if (!challenge.resolved) return false;
        }
        return true;
    }

    /**
     * Force-resolve any unresolved challenges (timeout).
     */
    forceResolveChallenges() {
        for (const challenge of this.challenges.values()) {
            if (!challenge.resolved) {
                this.resolveChallenge(challenge);
            }
        }
    }

    /**
     * Get challenge info for client display.
     */
    getChallengesForClient() {
        return Array.from(this.challenges.values()).map(c => ({
            id: c.id,
            challengerName: c.challengerName,
            targetPlayerId: c.targetPlayerId,
            targetPlayerName: c.targetPlayerName,
            category: c.category,
            answer: c.answer,
            resolved: c.resolved,
            result: c.result,
            voteCount: c.votes.size,
            eligibleVoters: this.getEligibleVoters(c).length
        }));
    }

    // ============ SCORING ============

    /**
     * Compute scores without applying them (used for preliminary display).
     */
    computeScores() {
        const categories = ['name', 'place', 'animal', 'thing'];
        const letter = this.currentLetter;

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

        for (const category of categories) {
            const answerGroups = new Map();

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

        for (const pa of playerAnswers) {
            pa.roundTotal = Object.values(pa.scores).reduce((sum, s) => sum + s, 0);
        }

        return playerAnswers;
    }

    /**
     * Finalize scores after challenge phase. Rejected answers get 0 points.
     * Applies scores to player totals and stores round data.
     */
    finalizeScores() {
        // Start with preliminary scores
        const results = this.computeScores();

        // Zero out rejected answers
        for (const challenge of this.challenges.values()) {
            if (challenge.resolved && challenge.result === 'rejected') {
                const playerResult = results.find(r => r.playerId === challenge.targetPlayerId);
                if (playerResult) {
                    playerResult.scores[challenge.category] = 0;
                }
            }
        }

        // Recalculate round totals
        for (const pa of results) {
            pa.roundTotal = Object.values(pa.scores).reduce((sum, s) => sum + s, 0);
            const player = this.players.get(pa.playerId);
            if (player) {
                player.totalScore += pa.roundTotal;
            }
        }

        // Store round history
        this.rounds.push({
            roundNumber: this.currentRound,
            letter: this.currentLetter,
            results: results,
            challenges: this.getChallengesForClient()
        });

        this.status = 'scoring';
        return results;
    }

    /**
     * Legacy method kept for compatibility — now routes through challenge flow.
     */
    scoreCurrentRound() {
        return this.finalizeScores();
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
        this.challenges = new Map();
        this.preliminaryResults = null;
        for (const player of this.players.values()) {
            player.totalScore = 0;
        }
    }

    toJSON() {
        return {
            code: this.code,
            totalRounds: this.totalRounds,
            timeLimit: this.timeLimit,
            challengeTimeLimit: this.challengeTimeLimit,
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
