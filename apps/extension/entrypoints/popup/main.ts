import "./style.css";
import tabbyLogo from "/icon/128.png";
import { setupCounter } from "@/components/counter";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <img src="${tabbyLogo}" class="logo" alt="Tabby" width="128" height="128" />
    <h1>Tabby</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <p class="read-the-docs">
      Every tab, exactly where it should be.
    </p>
  </div>
`;

setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
