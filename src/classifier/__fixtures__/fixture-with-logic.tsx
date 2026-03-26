import { useState } from "react";

interface CounterProps {
  initial?: number;
}

export const Counter = ({ initial = 0 }: CounterProps) => {
  const [count, setCount] = useState(initial);

  const handleClick = () => {
    setCount((prev) => prev + 1);
  };

  return (
    <div>
      <span className="count-display">{count}</span>
      <button onClick={handleClick}>Increment</button>
    </div>
  );
};
