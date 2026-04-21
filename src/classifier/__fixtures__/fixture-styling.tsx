// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — fixture is parsed by ts-morph for AST region mapping, not compiled
import styled from 'styled-components';

const Wrapper = styled.div`
  padding: 16px;
  background: white;
  border-radius: 8px;
`;

interface CardProps {
  title: string;
}

export const Card = ({ title }: CardProps) => {
  return (
    <Wrapper>
      <h2
        style={{ fontWeight: 'bold' }}
        className="card-title"
        data-testid="card-heading"
        aria-label={title}
      >
        {title}
      </h2>
      <div sx={{ mt: 2, p: 1 }}>
        <span tw="text-gray-500">Content</span>
      </div>
    </Wrapper>
  );
};
