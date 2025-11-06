// App.jsx
import React, {useEffect, useState, useRef} from 'react'

const API = 'http://localhost:8000'
const WS = 'ws://localhost:8000/ws'

export default function App(){
  const [symbols, setSymbols] = useState([])
  const [selected, setSelected] = useState(null)
  const [snapshot, setSnapshot] = useState({bids:[], asks:[]})
  const [trades, setTrades] = useState([])
  const [loadingSymbols, setLoadingSymbols] = useState(true)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)

  useEffect(()=>{
    setLoadingSymbols(true)
    setError(null)
    fetch(API + '/symbols')
      .then(r=>{
        if(!r.ok) throw new Error(`Failed to fetch symbols: ${r.status}`)
        return r.json()
      })
      .then(data=>{
        console.log('Symbols loaded:', data)
        setSymbols(data)
        setLoadingSymbols(false)
      })
      .catch(err=>{
        console.error('Error fetching symbols:', err)
        setError(err.message)
        setLoadingSymbols(false)
      })
  },[])

  useEffect(()=>{
    if(wsRef.current) {
      wsRef.current.close()
    }
    
    wsRef.current = new WebSocket(WS)
    
    wsRef.current.onopen = ()=> {
      console.log('WebSocket connected')
    }
    
    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
    
    wsRef.current.onclose = () => {
      console.log('WebSocket disconnected')
    }
    
    wsRef.current.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if(msg.type === 'order_event'){
          if(msg.symbol === selected){
            setSnapshot(msg.snapshot)
            if(msg.trades && msg.trades.length) {
              setTrades(prev=>[...msg.trades, ...prev].slice(0,200))
            }
          }
        }
      } catch(err) {
        console.error('Error parsing WebSocket message:', err)
      }
    }
    
    return ()=> {
      if(wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  },[selected])

  useEffect(()=>{ 
    if(selected){ 
      console.log('Fetching orderbook and trades for:', selected)
      Promise.all([
        fetch(API + '/orderbook/'+selected).then(r=>{
          if(!r.ok) throw new Error(`Failed to fetch orderbook: ${r.status}`)
          return r.json()
        }),
        fetch(API + '/trades/'+selected).then(r=>{
          if(!r.ok) throw new Error(`Failed to fetch trades: ${r.status}`)
          return r.json()
        })
      ])
      .then(([orderbook, tradesData])=>{
        console.log('Orderbook:', orderbook)
        console.log('Trades:', tradesData)
        setSnapshot(orderbook)
        setTrades(tradesData || [])
      })
      .catch(err=>{
        console.error('Error fetching data:', err)
        setError(err.message)
      })
    }
  },[selected])

  const place = async (side,type,price,qty)=>{
    if(!selected) return
    const user_id = 'user1'
    const body = {user_id, symbol:selected, side, type, price: type==='market' ? null : parseFloat(price), qty: parseFloat(qty)}
    try {
      console.log('Placing order:', body)
      const res = await fetch(API + '/order', {
        method:'POST', 
        headers:{'Content-Type':'application/json'}, 
        body: JSON.stringify(body)
      })
      if(!res.ok) {
        const errorData = await res.json().catch(()=>({detail: 'Unknown error'}))
        throw new Error(errorData.detail || `HTTP ${res.status}`)
      }
      const d = await res.json()
      console.log('Order placed successfully:', d)
      return d
    } catch(err) {
      console.error('Error placing order:', err)
      setError(err.message)
      throw err
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-gray-900">Mini Exchange — Demo</h1>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800 font-medium">Error</div>
            <div className="text-red-600 text-sm mt-1">{error}</div>
            <button 
              onClick={()=>setError(null)} 
              className="mt-2 text-sm text-red-700 underline"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="grid grid-cols-12 gap-6">
          {/* Symbol Selection Panel */}
          <div className="col-span-12 md:col-span-3">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Symbols</h2>
              {loadingSymbols ? (
                <div className="text-gray-500 text-sm py-4 text-center">Loading symbols...</div>
              ) : error ? (
                <div className="text-red-600 text-sm py-4 bg-red-50 border border-red-200 rounded-md p-3">
                  <div className="font-medium">Error loading symbols</div>
                  <div className="text-xs mt-1">{error}</div>
                  <button 
                    onClick={()=>window.location.reload()} 
                    className="mt-2 text-xs text-red-700 underline"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="space-y-1">
                  {symbols.map(s=> (
                    <button
                      key={s}
                      className={`w-full text-left px-4 py-2 rounded-md transition-colors ${
                        selected===s 
                          ? 'bg-blue-600 text-white font-medium' 
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                      onClick={()=>{
                        console.log('Symbol selected:', s)
                        setSelected(s)
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="col-span-12 md:col-span-9">
            {!selected ? (
              <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
                <div className="text-gray-400 text-lg mb-2">Select a symbol to start trading</div>
                <div className="text-gray-500 text-sm">Choose a symbol from the left panel to view orderbook and place orders</div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Symbol Header */}
                <div className="bg-white rounded-lg shadow-sm border p-4">
                  <h2 className="text-xl font-bold text-gray-900">{selected}</h2>
                </div>

                {/* Orderbook and Trades */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Orderbook */}
                  <div className="bg-white rounded-lg shadow-sm border p-4">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Orderbook (Top 10)</h3>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Bids */}
                      <div>
                        <div className="font-semibold text-green-700 mb-2 pb-2 border-b">Bids</div>
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {snapshot.bids.length > 0 ? (
                            snapshot.bids.map(([p,q], idx)=> (
                              <div key={`bid-${p}-${idx}`} className="flex justify-between text-sm py-1">
                                <span className="text-green-600 font-medium">{p.toFixed(2)}</span>
                                <span className="text-gray-600">{q.toFixed(2)}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-gray-400 text-sm py-2">No bids</div>
                          )}
                        </div>
                      </div>
                      
                      {/* Asks */}
                      <div>
                        <div className="font-semibold text-red-700 mb-2 pb-2 border-b">Asks</div>
                        <div className="space-y-1 max-h-96 overflow-y-auto">
                          {snapshot.asks.length > 0 ? (
                            snapshot.asks.map(([p,q], idx)=> (
                              <div key={`ask-${p}-${idx}`} className="flex justify-between text-sm py-1">
                                <span className="text-red-600 font-medium">{p.toFixed(2)}</span>
                                <span className="text-gray-600">{q.toFixed(2)}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-gray-400 text-sm py-2">No asks</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Recent Trades */}
                  <div className="bg-white rounded-lg shadow-sm border p-4">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Recent Trades</h3>
                    <div className="max-h-96 overflow-y-auto">
                      {trades.length > 0 ? (
                        <div className="space-y-1">
                          {trades.slice(0,20).map((t, idx)=> {
                            const timestamp = t.timestamp?.toFixed ? new Date(t.timestamp*1000).toLocaleTimeString() : 
                                             typeof t.timestamp === 'number' ? new Date(t.timestamp*1000).toLocaleTimeString() : 
                                             t.timestamp || '--'
                            return (
                              <div key={t.id || idx} className="flex justify-between items-center text-sm py-1 border-b border-gray-100">
                                <span className="text-gray-500 text-xs">{timestamp}</span>
                                <span className="font-medium">{t.price?.toFixed(2) || t.price}</span>
                                <span className="text-gray-600">x {t.qty?.toFixed(2) || t.qty}</span>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="text-gray-400 text-sm py-4">No trades yet</div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Order Form */}
                <OrderForm onPlace={place} selected={selected} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function OrderForm({onPlace, selected}){
  const [side,setSide]=useState('buy')
  const [type,setType]=useState('limit')
  const [price,setPrice]=useState('100')
  const [qty,setQty]=useState('1')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handlePlace = async () => {
    if(!selected || !qty || (type === 'limit' && !price)) return
    setIsSubmitting(true)
    try {
      const result = await onPlace(side,type,price,qty)
      console.log('Order placed successfully:', result)
      // Reset form after successful submission
      if(type === 'market') {
        setQty('1')
      } else {
        // Keep values for limit orders so user can adjust
      }
    } catch(error) {
      console.error('Error placing order:', error)
      alert(`Failed to place order: ${error.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Place Order</h3>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
        {/* Side Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Side</label>
          <select 
            value={side} 
            onChange={e=>setSide(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={!selected}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>

        {/* Order Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
          <select 
            value={type} 
            onChange={e=>{
              setType(e.target.value)
              if(e.target.value === 'market') {
                setPrice('')
              } else if(!price) {
                setPrice('100')
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={!selected}
          >
            <option value="limit">Limit</option>
            <option value="market">Market</option>
          </select>
        </div>

        {/* Price Input (only for limit orders) */}
        {type==='limit' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Price</label>
            <input 
              type="number"
              step="0.01"
              value={price} 
              onChange={e=>setPrice(e.target.value)}
              placeholder="100.00"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={!selected}
            />
          </div>
        )}

        {/* Quantity Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
          <input 
            type="number"
            step="0.01"
            value={qty} 
            onChange={e=>setQty(e.target.value)}
            placeholder="1.00"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={!selected}
          />
        </div>

        {/* Place Button */}
        <div>
          <button 
            onClick={handlePlace} 
            disabled={!selected || isSubmitting || !qty || (type === 'limit' && !price)}
            className={`w-full px-6 py-2 rounded-md font-medium transition-colors ${
              !selected || isSubmitting || !qty || (type === 'limit' && !price)
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : side === 'buy'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-red-600 text-white hover:bg-red-700'
            }`}
          >
            {isSubmitting ? 'Placing...' : `Place ${side === 'buy' ? 'Buy' : 'Sell'} Order`}
          </button>
        </div>
      </div>
      
      {!selected && (
        <div className="mt-4 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md p-3">
          Please select a symbol first to place an order
        </div>
      )}
    </div>
  )
}
