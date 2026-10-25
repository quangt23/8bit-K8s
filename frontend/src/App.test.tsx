import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "./App";
import { healthyBody, jsonResponse, stubFetch } from "./test/fetch";

describe("App", () => {
  it("shows the PixelGPU identity", async () => {
    stubFetch(async () => jsonResponse(healthyBody));
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "PixelGPU" })).toBeInTheDocument();
    await screen.findByText("Backend online");
  });

  it("shows backend details once the health check succeeds", async () => {
    stubFetch(async () => jsonResponse(healthyBody));
    render(<App />);

    await screen.findByText("Backend online");
    expect(screen.getByRole("status")).toHaveTextContent("Backend online");
    expect(screen.getByText("pixelgpu-backend")).toBeInTheDocument();
    expect(screen.getByText("API linked")).toBeInTheDocument();
  });

  it("explains when the backend is unreachable and recovers on retry", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    render(<App />);

    expect(await screen.findByText("Backend offline")).toBeInTheDocument();
    expect(screen.getByText("Could not reach the PixelGPU backend.")).toBeInTheDocument();

    fetchMock.mockImplementation(async () => jsonResponse(healthyBody));
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(await screen.findByText("Backend online")).toBeInTheDocument();
  });

  it("labels the hero scene as an illustration rather than live hardware", async () => {
    stubFetch(async () => jsonResponse(healthyBody));
    render(<App />);

    expect(screen.getByText(/Illustration only/)).toBeInTheDocument();
    await screen.findByText("Backend online");
  });
});
