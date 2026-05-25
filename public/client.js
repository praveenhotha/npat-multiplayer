const socket = io();

let isHost = false;
let hasSubmitted = false;
let currentVoteQueue = []; // Queue of challenges waiting for this player's vote
let challengedAnswers = new Set(); // Track which answers have been challenged (targetId_category)

// ============ DOM ELEMENTS ============

const screens = {
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    challenge: document.getElementById('challenge-screen'),
    results: document.getElementById('results-screen'),
    final: document.getElementById('final-screen')
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
}

// ============ HOME SCREEN ============

document.getElementById('create-btn').addEventListener('click', () => {
    const name = document.getElementById('create-name').value.trim();
    const rounds = parseInt(document.getElementById('create-rounds').value);

    if (!name) {
        showHomeError('Please enter your name');
        return;
    }

    socket.emit('create-room', { name, rounds });
});

document.getElementById('join-btn').addEventListener('click', () => {
    const code = document.getElementById('join-code').value.trim();
    const name = document.getElementById('join-name').value.trim();

    if (!code || !name) {
        showHomeError('Please enter room code and your name');
        return;
    }

    socket.emit('join-room', { code, name });
});

document.getElementById('create-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('create-btn').click();
});
document.getElementById('join-name').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('join-btn').click();
});

function showHomeError(msg) {
    document.getElementById('home-error').textContent = msg;
    setTimeout(() => { document.getElementById('home-error').textContent = ''; }, 3000);
}

// ============ LOBBY ============

document.getElementById('start-game-btn').addEventListener('click', () => {
    socket.emit('start-game');
});

function renderLobbyPlayers(players) {
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = players.map(p => `
        <div class="player-chip ${p.isHost ? 'host' : ''}">
            ${p.name} ${p.isHost ? '👑' : ''}
        </div>
    `).join('');

    const startBtn = document.getElementById('start-game-btn');
    const hostControls = document.getElementById('host-controls');
    const lobbyStatus = document.getElementById('lobby-status');

    if (isHost) {
        hostControls.classList.remove('hidden');
        lobbyStatus.classList.add('hidden');
        if (players.length >= 2) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Game';
        } else {
            startBtn.disabled = true;
            startBtn.textContent = 'Waiting for players...';
        }
    } else {
        hostControls.classList.add('hidden');
        lobbyStatus.classList.remove('hidden');
    }
}

// ============ GAME SCREEN ============

document.getElementById('submit-btn').addEventListener('click', submitAnswers);
document.getElementById('end-game-btn').addEventListener('click', () => {
    if (isHost && confirm('End the game for everyone?')) {
        socket.emit('end-game');
    }
});

function submitAnswers() {
    if (hasSubmitted) return;

    const answers = {
        name: document.getElementById('a-name').value.trim(),
        place: document.getElementById('a-place').value.trim(),
        animal: document.getElementById('a-animal').value.trim(),
        thing: document.getElementById('a-thing').value.trim()
    };

    socket.emit('submit-answers', { answers });
    hasSubmitted = true;

    document.getElementById('submit-btn').classList.add('hidden');
    document.getElementById('answer-form').style.opacity = '0.5';
    document.getElementById('answer-form').style.pointerEvents = 'none';
    document.getElementById('waiting-msg').classList.remove('hidden');
}

function setupGameScreen(data) {
    hasSubmitted = false;

    document.getElementById('g-round').textContent = data.round;
    document.getElementById('g-total').textContent = data.totalRounds;
    document.getElementById('g-letter').textContent = data.letter;
    document.getElementById('g-timer').textContent = data.timeLimit;
    document.getElementById('submit-count').textContent = '0';
    document.getElementById('player-count').textContent = data.totalPlayers || '?';

    document.getElementById('a-name').value = '';
    document.getElementById('a-place').value = '';
    document.getElementById('a-animal').value = '';
    document.getElementById('a-thing').value = '';

    const letter = data.letter;
    document.getElementById('a-name').placeholder = `Name starting with ${letter}`;
    document.getElementById('a-place').placeholder = `Place starting with ${letter}`;
    document.getElementById('a-animal').placeholder = `Animal starting with ${letter}`;
    document.getElementById('a-thing').placeholder = `Thing starting with ${letter}`;

    document.getElementById('submit-btn').classList.remove('hidden');
    document.getElementById('answer-form').style.opacity = '1';
    document.getElementById('answer-form').style.pointerEvents = 'auto';
    document.getElementById('waiting-msg').classList.add('hidden');

    document.getElementById('end-game-btn').style.display = isHost ? 'block' : 'none';
    document.getElementById('a-name').focus();

    showScreen('game');
}

// ============ CHALLENGE SCREEN ============

function showChallengePhase(data) {
    challengedAnswers = new Set();
    currentVoteQueue = [];

    document.getElementById('ch-letter').textContent = data.letter;
    document.getElementById('ch-timer').textContent = data.challengeTimeLimit;
    document.getElementById('challenges-list').innerHTML = '<p style="color:#666;font-size:0.85rem">No challenges yet</p>';
    document.getElementById('vote-modal').classList.add('hidden');

    // Build the answers table with challenge buttons
    const categories = ['name', 'place', 'animal', 'thing'];
    const catLabels = { name: '👤 Name', place: '🌍 Place', animal: '🐾 Animal', thing: '📦 Thing' };

    let html = `<table class="challenge-table"><thead><tr>
        <th>Player</th>`;
    for (const cat of categories) {
        html += `<th>${catLabels[cat]}</th>`;
    }
    html += `</tr></thead><tbody>`;

    for (const r of data.results) {
        const isMe = r.playerId === socket.id;
        html += `<tr><td>${r.playerName}${isMe ? ' (you)' : ''}</td>`;

        for (const cat of categories) {
            const val = r.answers[cat] || '';
            const score = r.scores[cat];
            const hasAnswer = val && score > 0;

            if (!hasAnswer) {
                html += `<td><span class="answer-cell empty">${val || '—'}</span></td>`;
            } else if (isMe) {
                html += `<td><span class="answer-cell own-answer">${val}</span></td>`;
            } else {
                const cellId = `cell_${r.playerId}_${cat}`;
                html += `<td><span class="answer-cell" id="${cellId}">${val} 
                    <button class="challenge-btn" 
                        data-target="${r.playerId}" 
                        data-category="${cat}"
                        data-answer="${val}">❌</button>
                </span></td>`;
            }
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;

    document.getElementById('challenge-answers-table').innerHTML = html;

    // Bind challenge buttons
    document.querySelectorAll('.challenge-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.dataset.target;
            const category = e.target.dataset.category;
            const key = `${target}_${category}`;

            if (challengedAnswers.has(key)) return;

            socket.emit('challenge-answer', { targetPlayerId: target, category });
            e.target.classList.add('disabled');
            e.target.textContent = '⏳';
        });
    });

    showScreen('challenge');
}

function addChallengeToList(challenge) {
    const key = `${challenge.targetPlayerId}_${challenge.category}`;
    challengedAnswers.add(key);

    // Disable the challenge button for this answer
    const btn = document.querySelector(`.challenge-btn[data-target="${challenge.targetPlayerId}"][data-category="${challenge.category}"]`);
    if (btn) {
        btn.classList.add('disabled');
        btn.textContent = '⚔️';
    }

    // Mark the cell
    const cellId = `cell_${challenge.targetPlayerId}_${challenge.category}`;
    const cell = document.getElementById(cellId);
    if (cell) {
        cell.classList.add('challenged');
    }

    // Add to challenges list
    const list = document.getElementById('challenges-list');
    if (list.querySelector('p')) {
        list.innerHTML = ''; // Remove "no challenges" message
    }

    const catLabels = { name: 'Name', place: 'Place', animal: 'Animal', thing: 'Thing' };
    const item = document.createElement('div');
    item.className = 'challenge-item';
    item.id = `challenge-${challenge.id}`;
    item.innerHTML = `
        <span>${challenge.challengerName} challenged <strong>${challenge.targetPlayerName}</strong>'s ${catLabels[challenge.category]}: "${challenge.answer}"</span>
        <span class="status ${challenge.resolved ? challenge.result : 'pending'}">
            ${challenge.resolved ? (challenge.result === 'rejected' ? '❌ Rejected' : '✅ Accepted') : '⏳ Voting...'}
        </span>
    `;
    list.appendChild(item);

    // If this challenge needs my vote (I'm not the challenger or target)
    if (!challenge.resolved && challenge.targetPlayerId !== socket.id) {
        // The challenger doesn't vote either — server handles this,
        // but we check client-side for UX
        const amChallenger = challenge.challengerName === getMyName();
        if (!amChallenger) {
            currentVoteQueue.push(challenge);
            showNextVote();
        }
    }
}

function getMyName() {
    // Get from whichever input was used
    return document.getElementById('create-name').value.trim() ||
           document.getElementById('join-name').value.trim() || '';
}

function showNextVote() {
    if (currentVoteQueue.length === 0) {
        document.getElementById('vote-modal').classList.add('hidden');
        return;
    }

    const challenge = currentVoteQueue[0];
    const catLabels = { name: 'Name', place: 'Place', animal: 'Animal', thing: 'Thing' };

    document.getElementById('vote-question').innerHTML = `
        Is "<strong>${challenge.answer}</strong>" a valid <strong>${catLabels[challenge.category]}</strong>?
        <br><small style="color:#aaa">${challenge.challengerName} challenged ${challenge.targetPlayerName}'s answer</small>
    `;

    document.getElementById('vote-modal').classList.remove('hidden');

    // Bind vote buttons (remove old listeners by replacing elements)
    const acceptBtn = document.getElementById('vote-accept');
    const rejectBtn = document.getElementById('vote-reject');
    const newAccept = acceptBtn.cloneNode(true);
    const newReject = rejectBtn.cloneNode(true);
    acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
    rejectBtn.parentNode.replaceChild(newReject, rejectBtn);

    newAccept.addEventListener('click', () => {
        socket.emit('vote-challenge', { challengeId: challenge.id, vote: 'accept' });
        currentVoteQueue.shift();
        showNextVote();
    });

    newReject.addEventListener('click', () => {
        socket.emit('vote-challenge', { challengeId: challenge.id, vote: 'reject' });
        currentVoteQueue.shift();
        showNextVote();
    });
}

function resolveChallengeUI(challengeId, result) {
    const item = document.getElementById(`challenge-${challengeId}`);
    if (item) {
        item.className = `challenge-item resolved-${result}`;
        const statusEl = item.querySelector('.status');
        if (statusEl) {
            statusEl.className = `status ${result}`;
            statusEl.textContent = result === 'rejected' ? '❌ Rejected' : '✅ Accepted';
        }
    }

    // Remove from vote queue if still pending
    currentVoteQueue = currentVoteQueue.filter(c => c.id !== challengeId);
    if (currentVoteQueue.length === 0) {
        document.getElementById('vote-modal').classList.add('hidden');
    }
}

// ============ RESULTS SCREEN ============

document.getElementById('next-round-btn').addEventListener('click', () => {
    socket.emit('next-round');
});

function showRoundResults(data) {
    document.getElementById('r-round').textContent = data.round;
    document.getElementById('r-letter').textContent = data.letter;

    // Show rejected answers summary
    const rejectedSummary = document.getElementById('rejected-summary');
    const rejectedChallenges = (data.challenges || []).filter(c => c.result === 'rejected');
    if (rejectedChallenges.length > 0) {
        const catLabels = { name: 'Name', place: 'Place', animal: 'Animal', thing: 'Thing' };
        rejectedSummary.innerHTML = `<strong>⚔️ Rejected answers:</strong> ` +
            rejectedChallenges.map(c => `${c.targetPlayerName}'s ${catLabels[c.category]} ("${c.answer}")`).join(', ');
        rejectedSummary.classList.remove('hidden');
    } else {
        rejectedSummary.classList.add('hidden');
    }

    // Build table
    const categories = ['name', 'place', 'animal', 'thing'];
    let html = `<table class="results-table"><thead><tr>
        <th>Player</th><th>👤 Name</th><th>🌍 Place</th><th>🐾 Animal</th><th>📦 Thing</th><th>Pts</th>
    </tr></thead><tbody>`;

    for (const r of data.results) {
        html += `<tr><td>${r.playerName}</td>`;
        for (const cat of categories) {
            const val = r.answers[cat] || '—';
            const score = r.scores[cat];
            let cls = 'wrong';
            if (score === 10) cls = 'unique';
            else if (score === 5) cls = 'duplicate';
            html += `<td class="${cls}">${val} <small>(${score})</small></td>`;
        }
        html += `<td class="points">${r.roundTotal}</td></tr>`;
    }
    html += `</tbody></table>`;
    document.getElementById('results-table').innerHTML = html;

    // Standings
    document.getElementById('standings').innerHTML = `<h3 style="margin-bottom:8px">Standings</h3>` +
        data.standings.map(s => `
            <div class="standing-row">
                <span class="name">${s.name}</span>
                <span class="score">${s.score} pts</span>
            </div>
        `).join('');

    const nextBtn = document.getElementById('next-round-btn');
    const waitMsg = document.getElementById('results-wait');

    if (isHost) {
        nextBtn.classList.remove('hidden');
        waitMsg.classList.add('hidden');
        nextBtn.textContent = data.hasMoreRounds ? 'Next Round' : 'See Final Results';
    } else {
        nextBtn.classList.add('hidden');
        waitMsg.classList.remove('hidden');
        waitMsg.textContent = 'Waiting for host to continue...';
    }

    showScreen('results');
}

// ============ FINAL SCREEN ============

document.getElementById('play-again-btn').addEventListener('click', () => {
    socket.emit('play-again');
});

function showFinalScreen(data) {
    const medals = ['🥇', '🥈', '🥉'];
    document.getElementById('final-standings').innerHTML = data.standings.map((s, i) => `
        <div class="final-player ${i === 0 ? 'winner' : ''}">
            <span class="rank">${medals[i] || `#${i + 1}`}</span>
            <span class="name">${s.name}</span>
            <span class="score">${s.score} pts</span>
        </div>
    `).join('');

    const playAgainBtn = document.getElementById('play-again-btn');
    const finalWait = document.getElementById('final-wait');
    if (isHost) {
        playAgainBtn.classList.remove('hidden');
        finalWait.classList.add('hidden');
    } else {
        playAgainBtn.classList.add('hidden');
        finalWait.classList.remove('hidden');
        finalWait.textContent = 'Waiting for host...';
    }

    showScreen('final');
}

// ============ SOCKET EVENT HANDLERS ============

socket.on('room-created', (data) => {
    isHost = true;
    document.getElementById('room-code').textContent = data.code;
    renderLobbyPlayers(data.players);
    showScreen('lobby');
});

socket.on('room-joined', (data) => {
    isHost = false;
    document.getElementById('room-code').textContent = data.code;
    renderLobbyPlayers(data.players);
    showScreen('lobby');
});

socket.on('player-joined', (data) => {
    renderLobbyPlayers(data.players);
});

socket.on('player-left', (data) => {
    const me = data.players.find(p => p.id === socket.id);
    if (me && me.isHost) {
        isHost = true;
    }
    renderLobbyPlayers(data.players);
});

socket.on('game-started', (data) => {
    data.totalPlayers = document.getElementById('lobby-player-list').children.length;
    setupGameScreen(data);
});

socket.on('round-started', (data) => {
    setupGameScreen(data);
});

socket.on('timer-tick', (data) => {
    const timerEl = document.getElementById('g-timer');
    timerEl.textContent = data.timeLeft;
    if (data.timeLeft <= 5) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }

    if (data.timeLeft <= 0 && !hasSubmitted) {
        submitAnswers();
    }
});

socket.on('player-submitted', (data) => {
    document.getElementById('submit-count').textContent = data.submittedCount;
    document.getElementById('player-count').textContent = data.totalPlayers;
});

// Challenge phase events
socket.on('challenge-phase-started', (data) => {
    showChallengePhase(data);
});

socket.on('challenge-timer-tick', (data) => {
    const timerEl = document.getElementById('ch-timer');
    timerEl.textContent = data.timeLeft;
    if (data.timeLeft <= 5) {
        timerEl.classList.add('urgent');
    } else {
        timerEl.classList.remove('urgent');
    }
});

socket.on('challenge-added', (data) => {
    addChallengeToList(data.challenge);
});

socket.on('vote-received', (data) => {
    // Could show vote progress indicator — keeping it simple for now
});

socket.on('challenge-resolved', (data) => {
    resolveChallengeUI(data.challengeId, data.result);
});

// Final results after challenges
socket.on('round-results', (data) => {
    showRoundResults(data);
});

socket.on('game-over', (data) => {
    showFinalScreen(data);
});

socket.on('back-to-lobby', (data) => {
    renderLobbyPlayers(data.players);
    showScreen('lobby');
});

socket.on('error-msg', (data) => {
    showHomeError(data.message);
});

socket.on('disconnect', () => {
    showHomeError('Disconnected from server. Refresh to reconnect.');
});
