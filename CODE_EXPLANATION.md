# Server.py - Complete Code Flow Explanation

## 📋 Table of Contents
1. [Overview](#overview)
2. [Architecture & Data Structures](#architecture--data-structures)
3. [Order Matching Engine](#order-matching-engine)
4. [API Endpoints & Workflow](#api-endpoints--workflow)
5. [Real-time Updates (WebSocket)](#real-time-updates-websocket)
6. [Complete Flow Example](#complete-flow-example)

---

## Overview

This is a **mini exchange matching engine** that:
- Maintains orderbooks for multiple trading symbols
- Matches buy and sell orders using **price-time priority**
- Broadcasts real-time updates via WebSocket
- Provides REST API for order placement and data retrieval

---

## Architecture & Data Structures

### 1. **Data Models (Pydantic)**

```python
OrderIn  → Input from client (what user wants to do)
Order    → Internal representation (with tracking fields)
Trade    → Executed trade between two orders
```

**Key Fields:**
- `OrderIn`: User's request (price, qty, side, type)
- `Order`: Adds `id`, `remaining`, `timestamp` for tracking
- `Trade`: Records actual execution (buy_order_id, sell_order_id, price, qty)

### 2. **OrderBook Class - The Heart of the System**

```python
class OrderBook:
    bids: List[Order]      # Buy orders (max-heap)
    asks: List[Order]      # Sell orders (min-heap)
    trades: List[Trade]    # History of executed trades
    lock: asyncio.Lock()   # Thread-safety for concurrent orders
```

**Critical Design Decision: Using Heaps for Price-Time Priority**

#### Why Heaps?
- **O(log n)** insert time
- **O(1)** peek at best price
- **O(log n)** remove best price
- Perfect for orderbook where we always need the "best" price

#### How Heaps Work Here:

**Bids (Buy Orders) - Max-Heap:**
```python
# Store as: (-price, timestamp, order)
# Python's heapq is MIN-heap, so we negate price to get MAX-heap behavior
heapq.heappush(self.bids, (-order.price, order.timestamp, order))
```
- Best bid = highest price (most willing to pay)
- If same price, earliest timestamp wins (FIFO)

**Asks (Sell Orders) - Min-Heap:**
```python
# Store as: (price, timestamp, order)
heapq.heappush(self.asks, (order.price, order.timestamp, order))
```
- Best ask = lowest price (most willing to sell)
- If same price, earliest timestamp wins (FIFO)

**Example:**
```
Bids heap: [(-105, 1.0, order1), (-103, 2.0, order2), (-100, 3.0, order3)]
           ↓
Best bid = 105 (highest price, negated back)

Asks heap: [(108, 1.0, order4), (110, 2.0, order5), (112, 3.0, order6)]
           ↓
Best ask = 108 (lowest price)
```

---

## Order Matching Engine

### `process_order()` - The Core Algorithm

**Step-by-Step Flow:**

#### Phase 1: Setup
```python
if order.side == 'buy':
    opp_heap = self.asks  # Match against sell orders
    price_ok = lambda ask_price: (market order) OR (limit_price >= ask_price)
else:  # sell
    opp_heap = self.bids  # Match against buy orders
    price_ok = lambda bid_price: (market order) OR (limit_price <= bid_price)
```

**Key Logic:**
- **Buy order** matches if: Market order OR limit price >= ask price
- **Sell order** matches if: Market order OR limit price <= bid price

#### Phase 2: Matching Loop
```python
while order.remaining > 0 and opp_heap exists:
    1. Peek at best opposite order (heap[0])
    2. Check if order is exhausted → remove if so
    3. Check price condition → break if can't match
    4. Execute trade:
       - Trade price = resting order's price (price-time priority)
       - Trade qty = min(new_order.remaining, resting_order.remaining)
       - Update remaining quantities
       - Create Trade record
    5. Remove resting order if fully filled
    6. Continue if new order still has remaining qty
```

**Example Walkthrough:**

**Initial State:**
```
Bids: [(105, 10 qty), (103, 5 qty)]
Asks: [(108, 8 qty), (110, 12 qty)]
```

**New Order: Buy Limit @ 106, Qty 15**

1. **Iteration 1:**
   - Best ask = 108
   - Check: 106 < 108? ❌ **BREAK** (can't match)
   - Result: Order goes to book as new bid

**New Order: Buy Limit @ 109, Qty 15**

1. **Iteration 1:**
   - Best ask = 108 (qty 8)
   - Check: 109 >= 108? ✅ **MATCH**
   - Trade: Price=108, Qty=8
   - New order: remaining = 15 - 8 = 7
   - Resting order: fully filled, remove from heap

2. **Iteration 2:**
   - Best ask = 110 (qty 12)
   - Check: 109 < 110? ❌ **BREAK**
   - Result: Remaining 7 qty goes to book at 109

**New Order: Buy Market, Qty 20**

1. **Iteration 1:**
   - Best ask = 108 (qty 8)
   - Check: Market order? ✅ **ALWAYS MATCH**
   - Trade: Price=108, Qty=8
   - Remaining = 12

2. **Iteration 2:**
   - Best ask = 110 (qty 12)
   - Trade: Price=110, Qty=12
   - Remaining = 0
   - **DONE** (order fully filled, nothing left for book)

#### Phase 3: Rest on Book
```python
if order.remaining > 0 and order.type == 'limit':
    # Add unfilled portion to orderbook
    if order.side == 'buy':
        self._push_bid(order)
    else:
        self._push_ask(order)
```

**Key Points:**
- Market orders **NEVER** rest on book (they match or fail)
- Only limit orders with remaining quantity go to book
- Orders are price-time priority (heap maintains this automatically)

---

## API Endpoints & Workflow

### 1. `GET /symbols`
```python
@app.get('/symbols')
async def get_symbols():
    return SYMBOLS  # ['SYM1', 'SYM2', ..., 'SYM10']
```
**Purpose:** Get list of available trading symbols

**Workflow:**
```
Client → GET /symbols → Server → ['SYM1', 'SYM2', ...]
```

---

### 2. `GET /orderbook/{symbol}`
```python
@app.get('/orderbook/{symbol}')
async def get_orderbook(symbol: str):
    if symbol not in orderbooks:
        raise HTTPException(404)
    return orderbooks[symbol].snapshot(depth=10)
```

**What `snapshot()` does:**
1. Iterates through all bids/asks in heaps
2. Aggregates by price level (sums quantities at same price)
3. Returns top 10 levels for each side
4. Sorted: bids (descending), asks (ascending)

**Example Output:**
```json
{
  "bids": [[105.5, 25.0], [105.0, 10.0], [104.5, 15.0]],
  "asks": [[108.0, 20.0], [108.5, 12.0], [109.0, 8.0]]
}
```

**Workflow:**
```
Client → GET /orderbook/SYM1 → Server → OrderBook.snapshot() → Aggregated levels
```

---

### 3. `GET /trades/{symbol}`
```python
@app.get('/trades/{symbol}')
async def get_trades(symbol: str):
    return [t.dict() for t in orderbooks[symbol].trades[-200:]]
```
**Purpose:** Get last 200 trades for a symbol

**Workflow:**
```
Client → GET /trades/SYM1 → Server → Last 200 Trade objects
```

---

### 4. `POST /order` - **The Critical Endpoint**

**Complete Flow:**

```python
@app.post('/order')
async def place_order(o: OrderIn):
    # 1. Validate symbol exists
    if o.symbol not in orderbooks:
        raise HTTPException(404)
    
    # 2. Create Order object with tracking fields
    order = Order(
        id=uuid.uuid4(),        # Unique identifier
        user_id=o.user_id,
        symbol=o.symbol,
        side=o.side,
        price=o.price,
        qty=o.qty,
        remaining=o.qty,        # Start with full quantity
        type=o.type,
        timestamp=time.time()   # Price-time priority
    )
    
    # 3. Get orderbook for this symbol
    ob = orderbooks[o.symbol]
    
    # 4. CRITICAL: Use lock to prevent race conditions
    async with ob.lock:
        trades = await ob.process_order(order)
    
    # 5. Broadcast update to all WebSocket clients
    await broadcast({
        'type': 'order_event',
        'symbol': o.symbol,
        'order': order.dict(),
        'trades': [t.dict() for t in trades],
        'snapshot': ob.snapshot()
    })
    
    # 6. Return response
    return {
        'order_id': order.id,
        'filled': len(trades) > 0,
        'trades': [t.dict() for t in trades]
    }
```

**Why the Lock?**
- Multiple orders can arrive simultaneously
- Without lock: race condition (two orders might read same state, both match incorrectly)
- With lock: orders processed sequentially per symbol (one at a time)

**Example Race Condition (without lock):**
```
Time 1: Order A reads best bid = 105
Time 2: Order B reads best bid = 105 (same!)
Time 3: Order A matches, removes bid
Time 4: Order B matches... ERROR! Bid already removed
```

---

## Real-time Updates (WebSocket)

### WebSocket Endpoint
```python
@app.websocket('/ws')
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()              # Accept connection
    connections.append(ws)         # Add to broadcast list
    try:
        while True:
            await ws.receive_text()  # Keep connection alive
    except WebSocketDisconnect:
        connections.remove(ws)      # Clean up on disconnect
```

**Purpose:** Maintain persistent connections for real-time updates

### Broadcast Function
```python
async def broadcast(message: dict):
    to_remove = []
    for ws in connections:
        try:
            await ws.send_json(message)  # Send to each client
        except Exception:
            to_remove.append(ws)         # Mark dead connections
    # Clean up dead connections
    for r in to_remove:
        connections.remove(r)
```

**When Broadcast Happens:**
- After every order placement (in `POST /order`)
- Sends: order details, executed trades, updated orderbook snapshot

**Message Format:**
```json
{
  "type": "order_event",
  "symbol": "SYM1",
  "order": {...},
  "trades": [...],
  "snapshot": {"bids": [...], "asks": [...]}
}
```

---

## Complete Flow Example

### Scenario: User Places Buy Limit Order

**Step 1: Client Request**
```javascript
POST /order
{
  "user_id": "user1",
  "symbol": "SYM1",
  "side": "buy",
  "type": "limit",
  "price": 105.5,
  "qty": 10
}
```

**Step 2: Server Processing**
```
1. Validate symbol exists ✅
2. Create Order object:
   - id: "abc-123"
   - remaining: 10
   - timestamp: 1234567890.123

3. Get orderbook for SYM1
4. Acquire lock (wait if another order processing)

5. Call process_order():
   - Check asks heap
   - Best ask = 108.0 (qty 5)
   - Check: 105.5 < 108.0? ❌ No match
   - Add to bids heap: (-105.5, 1234567890.123, order)

6. Release lock
7. Broadcast to all WebSocket clients:
   {
     "type": "order_event",
     "symbol": "SYM1",
     "order": {...},
     "trades": [],  // No trades executed
     "snapshot": {"bids": [[105.5, 10], ...], "asks": [...]}
   }

8. Return response:
   {
     "order_id": "abc-123",
     "filled": false,
     "trades": []
   }
```

**Step 3: Client Receives Update**
```
WebSocket message arrives → UI updates orderbook → Shows new bid at 105.5
```

### Scenario: Order Matches (Partially Filled)

**Initial State:**
```
Bids: [(105, 10), (104, 5)]
Asks: [(106, 8), (107, 12)]  ← New order will match this
```

**New Order: Buy Limit @ 107, Qty 15**

**Processing:**
```
1. Match against asks:
   - Best ask = 106 (qty 8)
   - 107 >= 106? ✅ Match!
   - Trade: Price=106, Qty=8
   - Remaining: 15 - 8 = 7

2. Continue matching:
   - Best ask = 107 (qty 12)
   - 107 >= 107? ✅ Match!
   - Trade: Price=107, Qty=7 (partial fill)
   - Remaining: 7 - 7 = 0

3. Order fully filled, nothing to add to book
4. Broadcast: 2 trades executed
```

---

## Startup & Initialization

### `seed_initial_orders()`
```python
@app.on_event('startup')
async def startup_event():
    await seed_initial_orders()
```

**What it does:**
- Creates 5 buy orders per symbol (prices 100-105 range)
- Creates 5 sell orders per symbol (prices 110-115 range)
- Gives each symbol some initial liquidity

**Why?**
- So UI has data to display immediately
- Demonstrates orderbook functionality

---

## Key Design Patterns

### 1. **Price-Time Priority**
- Orders at same price: earliest timestamp wins
- Implemented via: `(price, timestamp, order)` tuple in heap

### 2. **Maker-Taker Model**
- Maker = order that rests on book (limit orders)
- Taker = order that matches immediately (market orders)
- Trade executes at **maker's price** (resting order price)

### 3. **Thread Safety**
- One `asyncio.Lock()` per orderbook
- Prevents race conditions in concurrent order processing

### 4. **In-Memory Storage**
- All data in RAM (no database)
- Fast but not persistent
- Perfect for demo/testing

---

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|----------------|-------|
| Insert order | O(log n) | Heap insertion |
| Match order | O(k log n) | k = number of matches |
| Get snapshot | O(n) | Iterate all orders |
| Broadcast | O(c) | c = number of connections |

**Where n = number of orders in book**

---

## Limitations & Future Improvements

1. **No Persistence** → Add database (PostgreSQL, Redis)
2. **No Order Cancellation** → Add cancel endpoint
3. **No Order Types** → Add stop-loss, iceberg orders
4. **Simple Matching** → Could add pro-rata, time-in-force
5. **No User Authentication** → Add auth system
6. **Single-threaded matching** → Could parallelize per symbol

---

## Summary

**The Flow:**
1. **Order arrives** → `POST /order`
2. **Lock acquired** → Prevent race conditions
3. **Matching engine** → `process_order()` finds matches
4. **Update orderbook** → Add remaining to heap if needed
5. **Broadcast** → Send update to all WebSocket clients
6. **Return response** → Client knows what happened

**Key Insight:**
The heap data structure is the magic that makes this efficient. It automatically maintains price-time priority, so we always get the "best" order in O(1) time.

