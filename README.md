# Simple Exchange - Trading Platform Demo

A real-time trading platform demo with orderbook, trade execution, and WebSocket updates. Built with FastAPI (backend) and React + Vite (frontend).

## Prerequisites

Before you begin, ensure you have the following installed:

- **Python 3.8+** (for backend)
- **Node.js 16+** and **npm** (for frontend)

## Project Structure

```
simple_exchange/
├── server.py              # FastAPI backend server
├── requirements.txt       # Python dependencies
├── README.md             # This file
└── frontend/             # React frontend application
    ├── package.json
    ├── vite.config.js
    └── src/
        └── App.jsx       # Main React component
```

## Setup Instructions

### Backend Setup

1. **Navigate to the project directory:**
   ```bash
   cd simple_exchange
   ```

2. **Create a virtual environment (recommended):**
   ```bash
   python3 -m venv venv
   ```

3. **Activate the virtual environment:**
   - On macOS/Linux:
     ```bash
     source venv/bin/activate
     ```
   - On Windows:
     ```bash
     venv\Scripts\activate
     ```

4. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

 

### Frontend Setup

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

## Running the Application

### Start the Backend Server

1. **From the `simple_exchange` directory** (with virtual environment activated):
   ```bash
   python server.py
   ```

   Or using uvicorn directly:
   ```bash
   uvicorn server:app --host 0.0.0.0 --port 8000 --reload
   ```

   The backend will start on `http://localhost:8000`

### Start the Frontend Development Server

1. **Open a new terminal window** and navigate to the frontend directory:
   ```bash
   cd simple_exchange/frontend
   ```

2. **Start the development server:**
   ```bash
   npm run dev
   ```

   The frontend will typically start on `http://localhost:5173` (Vite default port)


## Usage

1. **Select a Symbol**: Click on any symbol (SYM1 through SYM10) from the left panel
2. **View Orderbook**: See the current bids and asks in the orderbook
3. **View Recent Trades**: Check the recent trades panel for executed trades
4. **Place Orders**: 
   - Select Buy or Sell
   - Choose Limit or Market order type
   - Enter price (for limit orders) and quantity
   - Click "Place Buy Order" or "Place Sell Order"
5. **Monitor LTP**: The Last Traded Price is displayed in the symbol header

## API Endpoints

### REST API

- `GET /symbols` - Get list of available symbols
- `GET /orderbook/{symbol}` - Get orderbook snapshot for a symbol
- `GET /trades/{symbol}` - Get recent trades for a symbol (last 200)
- `POST /order` - Place a new order
  ```json
  {
    "user_id": "user1",
    "symbol": "SYM1",
    "side": "buy",
    "type": "limit",
    "price": 100.50,
    "qty": 10.0
  }
  ```
