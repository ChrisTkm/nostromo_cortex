function getStatusLabel(status: number): string {
  switch (status) {
    case 0: return "pending";
    case 1: return "active";
    case 2: return "done";
    default: return "unknown";
  }
}
