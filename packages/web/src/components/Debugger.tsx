import React from 'react';

interface DebuggerProps {
    pointCount: number;
    connectionSource: "primary" | "backup" | "connecting";
}

const Debugger: React.FC<DebuggerProps> = ({ pointCount, connectionSource }) => {
    return (
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2000, background: 'white', padding: 10, borderRadius: 8, boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            <h3>Debugger</h3>
            <p>Total Points: {pointCount.toLocaleString()}</p>
            <div style={{ marginBottom: '8px' }}>
                <strong>Source: </strong>
                <span style={{
                    color: connectionSource === 'primary' ? 'green' : connectionSource === 'backup' ? 'orange' : 'gray',
                    fontWeight: 'bold'
                }}>
                    {connectionSource.toUpperCase()}
                </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#4D96FF', border: '2px solid white', boxShadow: '0 0 0 1px #4D96FF' }}></span>
                <span>Official</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#A0A0A0' }}></span>
                <span>P2P</span>
            </div>
        </div>
    );
};

export default Debugger;
