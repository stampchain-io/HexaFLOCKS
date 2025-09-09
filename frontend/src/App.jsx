import React, { useState } from 'react'
import axios from 'axios'

export default function App() {
  const [txid, setTxid] = useState('')
  const [imageB64, setImageB64] = useState('')
  const [metadata, setMetadata] = useState(null)
  const [txHash, setTxHash] = useState('')
  const [error, setError] = useState('')

  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000'

  const generate = async () => {
    setError(''); setTxHash('')
    try {
      if (!/^([0-9a-fA-F]{64})$/.test(txid.trim())) throw new Error('Invalid TXID format')
      const { data } = await axios.post(`${apiUrl}/generate`, { txid: txid.trim() })
      if (data.error) throw new Error(data.error)
      setImageB64(data.image_base64)
      setMetadata({ ...data.metadata, source_txid: txid.trim() })
    } catch (e) {
      setError(e.message)
    }
  }

  const mint = async () => {
    setError('')
    try {
      const { data } = await axios.post(`${apiUrl}/mint`, { image_base64: imageB64, metadata })
      if (data.error) throw new Error(data.error)
      setTxHash(data.tx_hash)
      alert(`Stamped! TX: ${data.tx_hash}\nPDF: ${data.pdf_path}`)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', textAlign: 'center', padding: 20 }}>
      <h1>HexaFlock Sheep Stamping App</h1>
      <div style={{ marginBottom: 12 }}>
        <input type="text" placeholder="64-hex Bitcoin TXID" value={txid} onChange={e => setTxid(e.target.value)} size={70} />
        <button style={{ marginLeft: 8 }} onClick={generate}>Generate</button>
      </div>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {imageB64 && (
        <div>
          <img style={{ imageRendering: 'pixelated', maxWidth: 400, border: '1px solid #ddd' }}
               src={`data:image/png;base64,${imageB64}`} alt="HexaFlock Sheep" />
          {metadata && (
            <>
              <p>{metadata.description}</p>
              <ul style={{ listStyle: 'none', textAlign: 'left', display: 'inline-block' }}>
                {Object.entries(metadata.traits || {}).map(([k, v]) => (
                  <li key={k}><strong>{k}</strong>: {String(v)}</li>
                ))}
              </ul>
            </>
          )}
          <div>
            <button onClick={mint}>Stamp on Bitcoin</button>
          </div>
          {txHash && <p>Stamped TX: {txHash}</p>}
        </div>
      )}
    </div>
  )
}
