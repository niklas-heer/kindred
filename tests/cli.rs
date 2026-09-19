use std::process::Command;

#[test]
fn help_describes_current_capabilities() {
    for arguments in [vec![], vec!["--help"], vec!["-h"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
            .args(arguments)
            .output()
            .expect("CLI should start");
        assert!(output.status.success());
        assert!(output.stderr.is_empty());
        let stdout = String::from_utf8(output.stdout).expect("help should be UTF-8");
        assert!(stdout.contains("Usage: kindred"));
        assert!(stdout.contains("not implemented"));
    }
}

#[test]
fn version_matches_release_metadata() {
    let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
        .arg("--version")
        .output()
        .expect("CLI should start");
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    assert_eq!(
        String::from_utf8(output.stdout)
            .expect("version should be UTF-8")
            .trim(),
        format!("kindred {}", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn unsupported_commands_fail_without_claiming_success() {
    for arguments in [vec!["serve"], vec!["--unknown"], vec!["--help", "extra"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_kindred"))
            .args(arguments)
            .output()
            .expect("CLI should start");
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("try --help"));
    }
}
