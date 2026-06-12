interface Props {
  items: string[];
}

class ListDisplay extends React.Component<Props> {
  render(): React.ReactNode {
    return <ul>{this.props.items.map((i) => <li key={i}>{i}</li>)}</ul>;
  }
}

export default ListDisplay;
