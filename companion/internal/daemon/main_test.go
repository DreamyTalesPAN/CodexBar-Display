package daemon

import (
	"os"
	"testing"

	"github.com/DreamyTalesPAN/CodexBar-Display/companion/internal/testenv"
)

// Every test of this package runs against a temporary home (#932): a test
// that forgets prepareFastTestEnv must not write into the running app's files.
func TestMain(m *testing.M) {
	os.Exit(testenv.Main(m))
}

func TestPackageTestsKeepAppFilesInTempHome(t *testing.T) {
	testenv.RequireTempPath(t, providerSnapshotsPath())
	testenv.RequireTempPath(t, lastGoodSnapshotPath())
}
