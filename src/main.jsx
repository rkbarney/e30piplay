import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ViewportScale from './components/ViewportScale.jsx'
import './global.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ViewportScale>
      <App />
    </ViewportScale>
  </React.StrictMode>,
)
