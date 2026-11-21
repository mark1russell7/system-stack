import { describe, expect, it } from "vitest";
import { isHttpsUrl, isOpenMode, isPath, isServiceName, isUserName, isVariableName, literalText, modeText } from "./forms.ts";

describe("the forms", () => {
  it("gives a mode in the form of stat", () => {
    expect(["644", "0644", "0600", "4755", "000"].map(modeText)).toEqual(["644", "644", "600", "4755", "0"]);
  });

  it("tells if each user can read a file of a mode", () => {
    expect(["600", "640", "0750", "4700"].map(isOpenMode)).toEqual([false, false, false, false]);
    expect(["644", "604", "601", "777"].map(isOpenMode)).toEqual([true, true, true, true]);
  });

  it("refuses a variable with a name of the shell or of sudo", () => {
    expect(["TOKEN", "A_1", "X"].map(isVariableName)).toEqual([true, true, true]);
    expect(["PATH", "HOME", "IFS", "LC_ALL", "SUDO_USER", "token", "1A", "_A"].map(isVariableName)).toEqual([false, false, false, false, false, false, false, false]);
  });

  it("knows the names of users and of services", () => {
    expect(["root", "_apt", "app-1", "machine$", "a".repeat(32)].map(isUserName)).toEqual([true, true, true, true, true]);
    expect(["Root", "1app", "a b", "a".repeat(33)].map(isUserName)).toEqual([false, false, false, false]);
    expect(["app", "app-web.v2"].map(isServiceName)).toEqual([true, true]);
    expect(["app.service", "app@1", "-app"].map(isServiceName)).toEqual([false, false, false]);
  });

  it("knows an absolute path and an HTTPS address", () => {
    expect(isPath("/etc/a.conf")).toBe(true);
    expect(isPath("/etc/..")).toBe(false);
    expect(["https://example.org/a?b=c", "https://example.org", "https://a.example.org:8443/x#y"].map(isHttpsUrl)).toEqual([true, true, true]);
    expect(["HTTPS://example.org/", "http://example.org/", "https://", "https:///a", "https://user:pass@example.org/", "https://-a.org/", "https://a b.org/"].map(isHttpsUrl)).toEqual([false, false, false, false, false, false, false]);
  });

  it("gives the text of a literal, and nothing for a text with a variable", () => {
    expect(literalText(["a", "b"])).toBe("ab");
    expect(literalText("a")).toBe("a");
    expect(literalText(["a", { $var: "B" }])).toBeUndefined();
  });
});
