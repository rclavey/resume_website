const ROWS = 6;
const COLS = 7;
const HUMAN = 1;
const AI = 2;
const MODEL_URL = 'models/connect-four/model.json?v=2';

let board = createEmptyBoard();
let gameOver = false;
let waitingForAi = true;
let aiModel = null;
let modelLoadPromise = null;

const boardElement = document.getElementById('connect-four-board');
const statusElement = document.getElementById('game-status');
const newGameButton = document.getElementById('new-game');

function createEmptyBoard() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function renderBoard() {
    boardElement.innerHTML = '';

    for (let col = 0; col < COLS; col += 1) {
        const columnButton = document.createElement('button');
        columnButton.type = 'button';
        columnButton.className = 'game-column';
        columnButton.setAttribute('aria-label', `Drop piece in column ${col + 1}`);
        columnButton.disabled = gameOver || waitingForAi || board[0][col] !== 0;
        columnButton.addEventListener('click', () => handleHumanMove(col));

        for (let row = 0; row < ROWS; row += 1) {
            const cell = document.createElement('span');
            cell.className = 'game-cell';
            if (board[row][col] === HUMAN) {
                cell.classList.add('human');
            } else if (board[row][col] === AI) {
                cell.classList.add('ai');
            }
            columnButton.appendChild(cell);
        }

        boardElement.appendChild(columnButton);
    }
}

function handleHumanMove(col) {
    if (gameOver || waitingForAi) {
        return;
    }

    const row = dropPiece(col, HUMAN);
    if (row === -1) {
        setStatus('That column is full. Choose another column.');
        return;
    }

    renderBoard();

    if (finishIfGameEnded(HUMAN)) {
        return;
    }

    requestAiMove();
}

function dropPiece(col, player) {
    for (let row = ROWS - 1; row >= 0; row -= 1) {
        if (board[row][col] === 0) {
            board[row][col] = player;
            return row;
        }
    }
    return -1;
}

function finishIfGameEnded(player) {
    if (hasWinner(player)) {
        gameOver = true;
        setStatus(player === HUMAN ? 'You win.' : 'The AI wins.');
        renderBoard();
        return true;
    }

    if (validMoves().length === 0) {
        gameOver = true;
        setStatus('Tie game.');
        renderBoard();
        return true;
    }

    return false;
}

function validMoves() {
    return Array.from({ length: COLS }, (_, col) => col).filter(col => board[0][col] === 0);
}

async function requestAiMove() {
    waitingForAi = true;
    setStatus('AI is thinking...');
    renderBoard();

    try {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const move = await chooseAiMove();
        if (!Number.isInteger(move) || !validMoves().includes(move)) {
            throw new Error('The AI returned an invalid move.');
        }

        dropPiece(move, AI);
        waitingForAi = false;
        renderBoard();

        if (!finishIfGameEnded(AI)) {
            setStatus('Your move. Choose a column.');
        }
    } catch (error) {
        console.error(error);
        waitingForAi = false;
        gameOver = true;
        setStatus('The AI could not make a move. Start a new game to try again.');
        renderBoard();
    }
}

async function chooseAiMove() {
    if (!aiModel) {
        throw new Error('The AI model is not loaded.');
    }

    const normalizedBoard = board.map(row => row.map(cell => {
        if (cell === AI) {
            return 1;
        }
        if (cell === HUMAN) {
            return -1;
        }
        return 0;
    }));

    const input = tf.tensor([normalizedBoard], [1, ROWS, COLS], 'float32');
    const prediction = aiModel.predict(input);

    try {
        const qValues = await prediction.data();
        return validMoves().reduce((bestMove, move) => (
            qValues[move] > qValues[bestMove] ? move : bestMove
        ));
    } finally {
        input.dispose();
        prediction.dispose();
    }
}

async function loadAiModel() {
    if (aiModel) {
        return aiModel;
    }
    if (modelLoadPromise) {
        return modelLoadPromise;
    }

    waitingForAi = true;
    gameOver = false;
    setStatus('Loading the abbreviated AI...');
    renderBoard();

    modelLoadPromise = (async () => {
        await tf.ready();
        const model = await tf.loadLayersModel(MODEL_URL, {
            onProgress: fraction => {
                const percent = Math.max(1, Math.round(fraction * 100));
                setStatus(`Loading the abbreviated AI... ${percent}%`);
            }
        });

        const warmupInput = tf.zeros([1, ROWS, COLS]);
        const warmupOutput = model.predict(warmupInput);
        await warmupOutput.data();
        warmupInput.dispose();
        warmupOutput.dispose();
        return model;
    })();

    try {
        aiModel = await modelLoadPromise;
        waitingForAi = false;
        setStatus('Your move. Choose a column.');
        renderBoard();
        return aiModel;
    } catch (error) {
        console.error(error);
        waitingForAi = false;
        gameOver = true;
        setStatus('The AI could not be loaded. Start a new game to try again.');
        renderBoard();
        throw error;
    } finally {
        modelLoadPromise = null;
    }
}

function hasWinner(player) {
    const directions = [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1]
    ];

    for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
            if (board[row][col] !== player) {
                continue;
            }

            for (const [dr, dc] of directions) {
                let count = 0;
                for (let step = 0; step < 4; step += 1) {
                    const nextRow = row + dr * step;
                    const nextCol = col + dc * step;
                    if (
                        nextRow >= 0 &&
                        nextRow < ROWS &&
                        nextCol >= 0 &&
                        nextCol < COLS &&
                        board[nextRow][nextCol] === player
                    ) {
                        count += 1;
                    }
                }
                if (count === 4) {
                    return true;
                }
            }
        }
    }

    return false;
}

function setStatus(message) {
    statusElement.textContent = message;
}

function resetGame() {
    board = createEmptyBoard();
    gameOver = false;
    waitingForAi = !aiModel;
    setStatus(aiModel ? 'Your move. Choose a column.' : 'Loading the abbreviated AI...');
    renderBoard();
    if (!aiModel) {
        loadAiModel().catch(() => {});
    }
}

newGameButton.addEventListener('click', resetGame);
renderBoard();
loadAiModel().catch(() => {});
