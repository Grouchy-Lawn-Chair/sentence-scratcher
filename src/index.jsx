// src/index.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// load both styles
import "./custom.css";   // classic
import "./arcade.css";   // arcade, only active when body has .theme-arcade

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
