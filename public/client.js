const socket = io();

let isHost = false;
let hasSubmitted = false;

// ============ DOM ELEMENTS ============

const screens = {
    home: document.getElementById('home-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
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

// Enter key support
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

    // Update start button
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

    // Reset form
    document.getElementById('a-name').value = '';
    document.getElementById('a-place').value = '';
    document.getElementById('a-animal').value = '';
    document.getElementById('a-thing').value = '';

    // Update placeholders
    const letter = data.letter;
    document.getElementById('a-name').placeholder = `Name starting with ${letter}`;
    document.getElementById('a-place').placeholder = `Place starting with ${letter}`;
    document.getElementById('a-animal').placeholder = `Animal starting with ${letter}`;
    document.getElementById('a-thing').placeholder = `Thing starting with ${letter}`;

    // Show form, hide waiting
    document.getElementById('submit-btn').classList.remove('hidden');
    document.getElementById('answer-form').style.opacity = '1';
    document.getElementById('answer-form').style.pointerEvents = 'auto';
    document.getElementById('waiting-msg').classList.add('hidden');

    // Show/hide end game button
    document.getElementById('end-game-btn').style.display = isHost ? 'block' : 'none';

    // Focus first input
    document.getElementById('a-name').focus();

    showScreen('game');
}

// ============ RESULTS SCREEN ============

document.getElementById('next-round-btn').addEventListener('click', () => {
    socket.emit('next-round');
});

function showRoundResults(data) {
    document.getElementById('r-round').textContent = data.round;
    document.getElementById('r-letter').textContent = data.letter;

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

    // Show/hide next round button based on host
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

    // Show play again only for host
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
    // Check if we became host
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

    // Auto-submit when time runs out
    if (data.timeLeft <= 0 && !hasSubmitted) {
        submitAnswers();
    }
});

socket.on('player-submitted', (data) => {
    document.getElementById('submit-count').textContent = data.submittedCount;
    document.getElementById('player-count').textContent = data.totalPlayers;
});

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
