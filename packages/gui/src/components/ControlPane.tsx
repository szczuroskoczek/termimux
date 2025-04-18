import React from 'react';

interface ControlPaneProps {
  onSplit: () => void;
}

export default function ControlPane({ onSplit }: ControlPaneProps) {
  return (
    <div className="control-pane">
      <button onClick={onSplit}>Split Terminal</button>
    </div>
  );
}
