import React, { useState } from 'react';

const units = [
  { name: 'EH/s', factor: 1e18 },
  { name: 'PH/s', factor: 1e15 },
  { name: 'TH/s', factor: 1e12 },
  { name: 'GH/s', factor: 1e9 },
  { name: 'MH/s', factor: 1e6 },
  { name: 'KH/s', factor: 1e3 },
  { name: 'H/s', factor: 1 },
];

const formatValue = (num) => {
  if (num === 0) return '';
  const str = num.toFixed(12);
  const [int, dec] = str.split('.');
  const formattedInt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cleanDec = dec.replace(/0+$/, '');
  return cleanDec ? `${formattedInt},${cleanDec}` : formattedInt;
};

const parseValue = (str) => {
  const clean = str.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
};

export default function HashrateCalculator() {
  const [hps, setHps] = useState(0);

  const handleChange = (value, factor) => {
    setHps(parseValue(value) * factor);
  };

  return (
    <div className="hashrate-calculator nh-theme">
      <h2 className="section-title" style={{ paddingBottom: '15px' }}>Hashrate Calculator</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {units.map((unit) => (
          <div key={unit.name} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center' }}>
            <label className="label" style={{ marginBottom: 0, fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}>{unit.name}</label>
            <input
              type="text"
              className="input-pro"
              placeholder={`0.00 ${unit.name}`}
              value={hps === 0 ? '' : formatValue(hps / unit.factor)}
              onChange={(e) => handleChange(e.target.value, unit.factor)}
            />
          </div>
        ))}
      </div>
      <p style={{ marginTop: '15px', fontSize: '10px', opacity: 0.4, fontStyle: 'italic', textAlign: 'center' }}>
        Reference: 1 EH/s = 1,000 PH/s = 1,000,000 TH/s
      </p>
    </div>
  );
}