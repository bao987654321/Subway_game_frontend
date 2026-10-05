import type { Meta, StoryObj } from '@storybook/react-vite'

import { TripLetters } from './TripLetters'

const meta = {
  title: 'Components/TripLetters',
  component: TripLetters,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ width: 'min(34rem, calc(100vw - 2rem))' }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    letters: {
      control: 'object',
      description: 'Collected route letters or numbers, preserving order and repeats.',
    },
  },
  args: {
    letters: ['A', 'C7', 'X'],
  },
} satisfies Meta<typeof TripLetters>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const SingleRoute: Story = {
  args: { letters: ['L'] },
}

export const Empty: Story = {
  args: { letters: [] },
}

export const RepeatedRoutes: Story = {
  args: { letters: ['A', '7', 'A', 'A', '7'] },
}

export const RouteColors: Story = {
  args: { letters: ['A', 'B', 'G', 'J', 'L', 'N', '1', '4', '7', 'FS', 'GS', 'H', 'SI', 'SIR', 'C7', 'X'] },
}

export const LongWrapping: Story = {
  args: {
    letters: ['1', '2', '3', '4', '5', '6', '7', 'A', 'C', 'E', 'B', 'D', 'F', 'M', 'G', 'J', 'Z', 'L', 'N', 'Q', 'R', 'W'],
  },
}
