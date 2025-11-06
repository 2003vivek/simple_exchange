from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Dict, List, Literal
import asyncio
import uvicorn
import heapq
import time
import uuid

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYMBOLS = [f"SYM{i}" for i in range(1, 11)]  # 10 symbols: SYM1..SYM10

# Order and trade models
class OrderIn(BaseModel):
    user_id: str
    symbol: str
    side: Literal['buy', 'sell']
    price: float | None = None  # None for market order
    qty: float
    type: Literal['limit', 'market'] = 'limit'

class Order(BaseModel):
    id: str
    user_id: str
    symbol: str
    side: str
    price: float | None
    qty: float
    remaining: float
    type: str
    timestamp: float

class Trade(BaseModel):
    id: str
    symbol: str
    price: float
    qty: float
    buy_order_id: str
    sell_order_id: str
    timestamp: float

# In-memory orderbooks: each with two heaps for price-time priority
# We'll store bids as max-heap (neg price) and asks as min-heap
class OrderBook:
    def __init__(self, symbol: str):
        self.symbol = symbol
        self.bids: List[Order] = []  # max-heap by price
        self.asks: List[Order] = []  # min-heap by price
        self.trades: List[Trade] = []
        self.lock = asyncio.Lock()
        self.last_prices: List[float] = []

    def _push_bid(self, order: Order):
        # heap item: (-price, timestamp, order)
        heapq.heappush(self.bids, (-order.price if order.price is not None else float('-inf'), order.timestamp, order))

    def _push_ask(self, order: Order):
        heapq.heappush(self.asks, (order.price if order.price is not None else float('inf'), order.timestamp, order))

    def get_ltp(self) -> float | None:
        # Return the last traded price (most recent price from last_prices)
        return self.last_prices[-1] if self.last_prices else None

    def snapshot(self, depth=10):
        # Return top `depth` aggregated levels for bids and asks
        bid_levels: Dict[float, float] = {}
        ask_levels: Dict[float, float] = {}
        for p, t, o in self.bids:
            price = -p
            bid_levels[price] = bid_levels.get(price, 0) + o.remaining
        for p, t, o in self.asks:
            price = p
            ask_levels[price] = ask_levels.get(price, 0) + o.remaining
        top_bids = sorted(bid_levels.items(), key=lambda x: x[0], reverse=True)[:depth]
        top_asks = sorted(ask_levels.items(), key=lambda x: x[0])[:depth]
        return {'bids': top_bids, 'asks': top_asks, 'ltp': self.get_ltp()}

    async def process_order(self, order: Order):
        # Simple matching: match market/limit against opposite side until filled or no match
        trades: List[Trade] = []
        if order.side == 'buy':
            opp_heap = self.asks
            get_price = lambda top: top[0]
            price_ok = lambda ask_price: (order.type == 'market') or (order.price is not None and order.price >= ask_price)
        else:
            opp_heap = self.bids
            get_price = lambda top: -top[0]
            price_ok = lambda bid_price: (order.type == 'market') or (order.price is not None and order.price <= bid_price)

        # Match while possible
        while order.remaining > 1e-9 and opp_heap:
            top_price, ts, top_order = opp_heap[0]
            top_price_val = get_price((top_price, ts, top_order))
            if top_order.remaining <= 1e-9:
                heapq.heappop(opp_heap)
                continue
            # Check price condition
            if not price_ok(top_price_val):
                break
            # Execute trade at resting order price (price-time priority)
            trade_price = top_price_val
            trade_qty = min(order.remaining, top_order.remaining)
            order.remaining -= trade_qty
            top_order.remaining -= trade_qty
            tr = Trade(
                id=str(uuid.uuid4()),
                symbol=self.symbol,
                price=trade_price,
                qty=trade_qty,
                buy_order_id=order.id if order.side=='buy' else top_order.id,
                sell_order_id=top_order.id if order.side=='buy' else order.id,
                timestamp=time.time()
            )
            self.trades.append(tr)
            trades.append(tr)
            # remove top if exhausted
            if top_order.remaining <= 1e-9:
                heapq.heappop(opp_heap)
            # record last trade price
            self.last_prices.append(trade_price)
        # If remaining and limit order, push into its side
        if order.remaining > 1e-9 and order.type == 'limit':
            if order.side == 'buy':
                self._push_bid(order)
            else:
                self._push_ask(order)
        return trades

# Global state
orderbooks: Dict[str, OrderBook] = {s: OrderBook(s) for s in SYMBOLS}
connections: List[WebSocket] = []

@app.get('/symbols')
async def get_symbols():
    return SYMBOLS

@app.get('/orderbook/{symbol}')
async def get_orderbook(symbol: str):
    if symbol not in orderbooks:
        raise HTTPException(status_code=404, detail='Symbol not found')
    return orderbooks[symbol].snapshot()

@app.get('/trades/{symbol}')
async def get_trades(symbol: str):
    if symbol not in orderbooks:
        raise HTTPException(status_code=404, detail='Symbol not found')
    return [t.dict() for t in orderbooks[symbol].trades[-200:]]

@app.post('/order')
async def place_order(o: OrderIn):
    if o.symbol not in orderbooks:
        raise HTTPException(status_code=404, detail='Symbol not found')
    now = time.time()
    order = Order(
        id=str(uuid.uuid4()),
        user_id=o.user_id,
        symbol=o.symbol,
        side=o.side,
        price=o.price,
        qty=o.qty,
        remaining=o.qty,
        type=o.type,
        timestamp=now
    )
    ob = orderbooks[o.symbol]
    async with ob.lock:
        trades = await ob.process_order(order)
    # broadcast update
    snapshot_data = ob.snapshot()
    await broadcast({
        'type': 'order_event',
        'symbol': o.symbol,
        'order': order.dict(),
        'trades': [t.dict() for t in trades],
        'snapshot': snapshot_data
    })
    return {'order_id': order.id, 'filled': len(trades) > 0, 'trades': [t.dict() for t in trades]}

@app.websocket('/ws')
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connections.append(ws)
    try:
        while True:
            msg = await ws.receive_text()  # simple pings from client allowed
            # No heavy processing
    except WebSocketDisconnect:
        connections.remove(ws)

async def broadcast(message: dict):
    to_remove = []
    for ws in connections:
        try:
            await ws.send_json(message)
        except Exception:
            to_remove.append(ws)
    for r in to_remove:
        if r in connections:
            connections.remove(r)

# Simple initializer to seed some orders so UI has data
async def seed_initial_orders():
    import random
    for s in SYMBOLS:
        ob = orderbooks[s]
        # create some randomized limit orders on both sides
        for i in range(5):
            p = 100 + random.random()*10 + i
            o = Order(
                id=str(uuid.uuid4()), user_id='seed', symbol=s, side='buy', price=round(p,2), qty=10+i, remaining=10+i, type='limit', timestamp=time.time()-100+i
            )
            ob._push_bid(o)
        for i in range(5):
            p = 110 + random.random()*10 + i
            o = Order(
                id=str(uuid.uuid4()), user_id='seed', symbol=s, side='sell', price=round(p,2), qty=8+i, remaining=8+i, type='limit', timestamp=time.time()-100+i
            )
            ob._push_ask(o)

@app.on_event('startup')
async def startup_event():
    await seed_initial_orders()

if __name__ == '__main__':
    uvicorn.run('server:app', host='0.0.0.0', port=8000, reload=True)
