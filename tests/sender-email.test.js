const { sendResetEmail, isConfigured } = require('../src/services/email.service');

describe('Sender transactional password email', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; delete global.fetch; });
  it('uses correct Sender endpoint and does not expose token in body', async () => {
    Object.assign(process.env, {
      EMAIL_PROVIDER: 'sender', SENDER_API_TOKEN: 'test-token-not-real',
      EMAIL_FROM: 'services@artandlanguage.com.mx', EMAIL_FROM_NAME: 'Art & Language'
    });
    global.fetch = jest.fn(async () => ({ok:true,status:202}));
    expect(isConfigured()).toBe(true);
    await sendResetEmail('student@example.com', 'https://example.com/reset-password?token=test-only');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.sender.net/v2/message/send');
    expect(opts.headers.Authorization).toBe('Bearer test-token-not-real');
    const data = JSON.parse(opts.body);
    expect(data.from).toEqual({email:'services@artandlanguage.com.mx',name:'Art & Language'});
    expect(data.to).toEqual({email:'student@example.com'});
    expect(data.html).toContain('reset-password?token=test-only');
    expect(opts.body).not.toContain('test-token-not-real');
  });
  it('keeps Resend compatibility', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'stub-only', EMAIL_FROM: 'Art & Language <no-reply@example.com>' });
    global.fetch = jest.fn(async () => ({ok:true,status:200}));
    await sendResetEmail('student@example.com','https://example.com/reset');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });
  it('rejects missing Sender token', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER:'sender', EMAIL_FROM:'services@artandlanguage.com.mx' });
    delete process.env.SENDER_API_TOKEN;
    expect(isConfigured()).toBe(false);
    await expect(sendResetEmail('student@example.com','https://example.com/reset')).rejects.toThrow('not configured');
  });
});
